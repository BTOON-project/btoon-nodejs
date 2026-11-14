// SPDX-FileCopyrightText: 2025 Alvar Laigna <https://alvarlaigna.com>
// SPDX-License-Identifier: MIT
//
// Node-API addon for BTOON. JS values are encoded straight into btoon::Encoder
// (no intermediate tree); bytes are decoded by btoon-core's hardened decoder
// into a btoon::Value and then converted to JS. The JS-facing classes
// (BtoonError, Ext, Timestamp, BtoonDate, BtoonDateTime) and the helpers that
// classify JS values are defined in index.js and passed to setup().

// While a worker thread is being terminated, Node-API can neither call into JS nor throw.
// AsyncWorker callbacks that finish then (OnOK/OnError) fail, and without this node-addon-api
// rethrew the failure out of the libuv callback, where it ended in std::terminate and took
// the whole process down. With it, an exception that can't be thrown is dropped.
#define NODE_API_SWALLOW_UNTHROWABLE_EXCEPTIONS
#include <napi.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "btoon/btoon.h"
#include "btoon/encoder.h"

using namespace btoon;

// For helpers that encode() calls on its way down: inlined, their locals would sit in every
// frame of the recursion and shrink the nesting depth the stack can take.
#if defined(_MSC_VER)
#define BTOON_NOINLINE __declspec(noinline)
#else
#define BTOON_NOINLINE __attribute__((noinline))
#endif

namespace {

struct AddonData {
    // The classes of index.js.
    Napi::FunctionReference BtoonError, Ext, Timestamp, BtoonDate, BtoonDateTime;
    // index.js's helpers for the encoder: classify, unbox, mapKeys, mapGet, bytesOf.
    Napi::FunctionReference Classify, Unbox, MapKeys, MapGet, BytesOf, TypedArrayByteLength;
    Napi::ObjectReference ObjectPrototype;
};

AddonData* data_of(Napi::Env env) {
    auto* d = env.GetInstanceData<AddonData>();
    if (!d) throw Napi::Error::New(env, "btoon: native module not initialized (call setup first)");
    return d;
}

// A JS exception carrying a spec error code: new BtoonError(code, message).
[[noreturn]] void throw_btoon(Napi::Env env, const char* code, const std::string& message) {
    Napi::Value err = data_of(env)->BtoonError.New({Napi::String::New(env, code), Napi::String::New(env, message)});
    throw Napi::Error(env, err);
}

// Turns a failed Node-API call into a C++ exception. When the call ran JS that threw (a getter,
// a Proxy trap, toJSON), the pending JS exception is what gets rethrown. A failed call leaves
// its outputs unwritten, so they must never be used: an uninitialized napi_value from a
// throwing getter used to crash the process.
void check(Napi::Env env, napi_status status) {
    if (status != napi_ok) throw Napi::Error::New(env);
}

// --- typed arrays ---------------------------------------------------------------------------

// The bytes of a typed array. node-addon-api's TypedArray::ByteLength() multiplies the length
// by an element size from its own table, which lacks newer types: a Float16Array came out
// empty on Node 24+, and as half its bytes on Node 22 (whose napi leaves the type unset). So
// the type is read with an "unknown" default, and the size of a type napi doesn't name comes
// from the %TypedArray%.prototype.byteLength getter, which user code can't shadow.
// kOtherTypedArray is the "unset" default: 15 is in the enum's range but names no type.
constexpr auto kOtherTypedArray = static_cast<napi_typedarray_type>(15);

struct TypedBytes {
    napi_typedarray_type type;  // kOtherTypedArray if this napi doesn't name it
    size_t length;              // elements
    std::span<const uint8_t> bytes;
};

size_t element_size(napi_typedarray_type type) {
    switch (type) {
        case napi_int8_array:
        case napi_uint8_array:
        case napi_uint8_clamped_array: return 1;
        case napi_int16_array:
        case napi_uint16_array: return 2;
        case napi_int32_array:
        case napi_uint32_array:
        case napi_float32_array: return 4;
        case napi_float64_array:
        case napi_bigint64_array:
        case napi_biguint64_array: return 8;
        default: return 0;
    }
}

TypedBytes typed_array_bytes(Napi::Env env, napi_value ta) {
    napi_typedarray_type type = kOtherTypedArray;
    size_t length = 0;
    void* data = nullptr;
    check(env, napi_get_typedarray_info(env, ta, &type, &length, &data, nullptr, nullptr));
    size_t size = element_size(type);
    size_t n = length * size;
    if (size == 0) {
        type = kOtherTypedArray;
        Napi::Value bl = data_of(env)->TypedArrayByteLength.Call(ta, {});
        n = static_cast<size_t>(bl.As<Napi::Number>().Int64Value());
    }
    if (n == 0 || data == nullptr) return {type, length, {}};
    return {type, length, {static_cast<const uint8_t*>(data), n}};
}

std::span<const uint8_t> dataview_bytes(Napi::Env env, napi_value dv) {
    size_t n = 0;
    void* data = nullptr;
    check(env, napi_get_dataview_info(env, dv, &n, &data, nullptr, nullptr));
    if (n == 0 || data == nullptr) return {};
    return {static_cast<const uint8_t*>(data), n};
}

std::span<const uint8_t> arraybuffer_bytes(Napi::Env env, napi_value ab) {
    size_t n = 0;
    void* data = nullptr;
    check(env, napi_get_arraybuffer_info(env, ab, &data, &n));
    if (n == 0 || data == nullptr) return {};
    return {static_cast<const uint8_t*>(data), n};
}

// A Uint8Array (a Buffer is one) of any realm, by its internal type.
bool is_uint8_array(Napi::Env env, napi_value v) {
    bool is_typed = false;
    check(env, napi_is_typedarray(env, v, &is_typed));
    if (!is_typed) return false;
    napi_typedarray_type type = kOtherTypedArray;
    size_t length = 0;
    check(env, napi_get_typedarray_info(env, v, &type, &length, nullptr, nullptr, nullptr));
    return type == napi_uint8_array;
}

// --- JS -> bytes ------------------------------------------------------------------------
//
// A port of @btoon/js's encoder (encode.ts), the reference for both packages: the same
// classification of values, the same reads of user code (getters, toJSON(), Proxy traps) in
// the same order, and the same errors. The kinds are its K_* numbers, which index.js's
// classify() returns too.

enum Kind : int32_t {
    K_NONE = 0,  // not an object
    K_ARRAY = 1,
    K_PLAIN = 2,  // prototype Object.prototype or null, without an own toJSON()
    K_VIEW = 3,
    K_BUFFER = 4,
    K_DATE = 5,
    K_MAP = 6,  // a Map of any realm: read with the intrinsic Map methods
    K_TIMESTAMP = 7,
    K_EXT = 8,
    K_TOJSON = 9,  // a class's toJSON(), or a plain object's own
    K_BOXED = 10,
    K_OBJECT = 11,  // any other object: its own enumerable string-keyed properties
    K_BTOON_DATE = 12,
    K_BTOON_DATETIME = 13,
    K_PROXY_MAP = 14,  // a Proxy of a Map: read through its own keys() and get()
};

// A map key: its UTF-8 bytes, to sort and write, and the JS string, to read the value with.
struct Key {
    std::string utf8;
    napi_value js;
};
using Keys = std::vector<Key>;

// What to encode instead of a raw Ext with an id BTOON defines (spec §5.7), as in @btoon/js.
const char* typed_instead(int type) {
    switch (type) {
        case -1: return "encode a Date or Timestamp";
        case -2: return "encode a BtoonDate";
        case -3: return "encode a BtoonDateTime";
        case -4: return "encode a bigint";
        case -5: return "encode a Float32Array";
        case -6: return "encode a Float64Array";
        case -10: return "encode an array of objects, which uses the tabular encoding where it is smaller";
        default: return nullptr;
    }
}

class JsEncoder {
public:
    JsEncoder(Napi::Env env, Encoder& enc, size_t max_depth, bool tabular)
        : env_(env), enc_(enc), max_depth_(max_depth), tabular_(tabular), d_(data_of(env)) {}

    void encode(Napi::Value v) { any(v, 0, true); }

private:
    // Nested values recurse through any(), object() and array(), plain_map(), map_object() or
    // try_tabular(): keep their frames small.
    void any(Napi::Value v, size_t depth, bool allow_to_json) {
        switch (v.Type()) {
            case napi_undefined:
            case napi_null: return enc_.encodeNil();
            case napi_boolean: return enc_.encodeBool(v.As<Napi::Boolean>().Value());
            case napi_number: return encode_number(v.As<Napi::Number>().DoubleValue());
            case napi_bigint: return encode_bigint(v.As<Napi::BigInt>());
            case napi_string: return encode_string(v);
            case napi_object: {
                Napi::Object o = v.As<Napi::Object>();
                return object(o, kind_of(o), depth, allow_to_json);
            }
            default: unsupported(v.Type());
        }
    }

    void object(Napi::Object o, Kind kind, size_t depth, bool allow_to_json) {
        switch (kind) {
            case K_ARRAY: return array(o, depth);
            case K_VIEW: return encode_view(o);
            case K_BUFFER: return encode_buffer(o);
            case K_DATE: return encode_date(o);
            case K_MAP:
            case K_PROXY_MAP: return map_object(o, kind, depth);
            case K_TIMESTAMP: return encode_timestamp(o);
            case K_BTOON_DATE: return encode_epoch(o, false);
            case K_BTOON_DATETIME: return encode_epoch(o, true);
            case K_EXT: return encode_ext(o);
            case K_TOJSON:
                // Like JSON.stringify, toJSON() is called once per value: a result that has its
                // own toJSON() is encoded by its own enumerable properties. It adds no depth.
                if (allow_to_json) return any(call_to_json(o), depth, false);
                return plain_map(o, depth);
            case K_BOXED: return any(unbox(o), depth, allow_to_json);
            default: return plain_map(o, depth);  // K_PLAIN, K_OBJECT
        }
    }

    [[noreturn]] BTOON_NOINLINE void unsupported(napi_valuetype t) {
        const char* name = t == napi_function ? "function" : t == napi_symbol ? "symbol" : "value of this type";
        throw_btoon(env_, "invalid_argument", std::string("cannot encode a ") + name);
    }

    [[noreturn]] BTOON_NOINLINE void max_depth_exceeded() {
        throw_btoon(env_, "max_depth", "maximum nesting depth exceeded (or the value is cyclic)");
    }

    void check_depth(size_t depth) {
        if (depth >= max_depth_) max_depth_exceeded();
    }

    // --- classification ------------------------------------------------------------------

    // Arrays, plain objects, typed arrays, ArrayBuffers and Dates are settled here without a
    // call into JS. Every other object goes to index.js's classify(), which is @btoon/js's
    // classification. napi_get_prototype never runs a Proxy's getPrototypeOf trap and reports
    // null for every Proxy, so a null prototype (Object.create(null), or a Proxy: Vue and MobX
    // reactive state) is classified in JS too, where Array.isArray and Object.getPrototypeOf
    // see through proxies.
    BTOON_NOINLINE Kind kind_of(Napi::Object o) {
        bool yes = false;
        check(env_, napi_is_array(env_, o, &yes));
        if (yes) return K_ARRAY;
        napi_value proto;
        check(env_, napi_get_prototype(env_, o, &proto));
        check(env_, napi_strict_equals(env_, proto, d_->ObjectPrototype.Value(), &yes));
        if (yes) return own_to_json(o) ? K_TOJSON : K_PLAIN;
        napi_valuetype t;
        check(env_, napi_typeof(env_, proto, &t));
        if (t != napi_null) {
            check(env_, napi_is_typedarray(env_, o, &yes));
            if (!yes) check(env_, napi_is_dataview(env_, o, &yes));
            if (yes) return K_VIEW;
            check(env_, napi_is_arraybuffer(env_, o, &yes));
            if (yes) return K_BUFFER;
            check(env_, napi_is_date(env_, o, &yes));
            if (yes) return K_DATE;
        }
        napi_value arg = o, kind;
        check(env_, napi_call_function(env_, env_.Undefined(), d_->Classify.Value(), 1, &arg, &kind));  // traps can throw
        int32_t k = 0;
        check(env_, napi_get_value_int32(env_, kind, &k));
        return k >= K_ARRAY && k <= K_PROXY_MAP ? static_cast<Kind>(k) : K_OBJECT;
    }

    Kind kind_of_value(Napi::Value v) { return v.IsObject() ? kind_of(v.As<Napi::Object>()) : K_NONE; }

    napi_value to_json_key() {
        if (to_json_key_ == nullptr) to_json_key_ = Napi::String::New(env_, "toJSON");
        return to_json_key_;
    }

    // A plain object's own toJSON(), which JSON.stringify calls. An inherited one, such as a
    // polluted Object.prototype.toJSON, is ignored.
    bool own_to_json(Napi::Object o) {
        bool own = false;
        check(env_, napi_has_own_property(env_, o, to_json_key(), &own));
        if (!own) return false;
        napi_value fn;
        check(env_, napi_get_property(env_, o, to_json_key(), &fn));
        napi_valuetype t;
        check(env_, napi_typeof(env_, fn, &t));
        return t == napi_function;
    }

    BTOON_NOINLINE Napi::Value call_to_json(Napi::Object o) {
        napi_value fn, result;
        check(env_, napi_get_property(env_, o, to_json_key(), &fn));
        napi_valuetype t;
        check(env_, napi_typeof(env_, fn, &t));
        if (t != napi_function) throw Napi::TypeError::New(env_, "toJSON is not a function");
        check(env_, napi_call_function(env_, o, fn, 0, nullptr, &result));
        return Napi::Value(env_, result);
    }

    BTOON_NOINLINE Napi::Value unbox(Napi::Object o) { return d_->Unbox.Call({o}); }

    // --- scalars ---------------------------------------------------------------------------

    void encode_number(double d) {
        // Safe integers are integers; everything else (including -0) is float64.
        if (std::isfinite(d) && d == std::trunc(d) && std::fabs(d) <= 9007199254740991.0 && !(d == 0 && std::signbit(d))) {
            return enc_.encodeInt(static_cast<int64_t>(d));
        }
        enc_.encodeFloat(d);
    }

    BTOON_NOINLINE void encode_bigint(Napi::BigInt b) {
        bool lossless = false;
        int64_t i = b.Int64Value(&lossless);
        if (lossless) return enc_.encodeInt(i);
        uint64_t u = b.Uint64Value(&lossless);
        if (lossless) return enc_.encodeUint(u);
        // Arbitrary precision -> two's complement big-endian (SPEC §5.4).
        int sign = 0;
        size_t count = b.WordCount();
        std::vector<uint64_t> words(count);
        b.ToWords(&sign, &count, words.data());
        std::vector<uint8_t> mag;  // big-endian magnitude
        for (size_t w = count; w-- > 0;) {
            for (int k = 7; k >= 0; --k) mag.push_back(static_cast<uint8_t>(words[w] >> (8 * k)));
        }
        mag.insert(mag.begin(), 0);  // room for the sign bit
        if (sign) {
            for (auto& x : mag) x = static_cast<uint8_t>(~x);
            for (size_t j = mag.size(); j-- > 0;) {
                if (++mag[j] != 0) break;
            }
        }
        enc_.encodeBigInt(mag);  // normalizes to minimal length
    }

    BTOON_NOINLINE void encode_string(Napi::Value s) { enc_.encodeString(utf8(s)); }

    // One call in the common case: a truncated copy leaves at most 3 bytes (a split UTF-8
    // sequence) plus the terminator unused, so more free space than that proves completeness.
    std::string_view utf8(Napi::Value s) {
        if (scratch_.size() < 4096) scratch_.resize(4096);
        size_t len = 0;
        check(env_, napi_get_value_string_utf8(env_, s, scratch_.data(), scratch_.size(), &len));
        if (len + 5 > scratch_.size()) {
            check(env_, napi_get_value_string_utf8(env_, s, nullptr, 0, &len));
            scratch_.resize(len + 1);
            check(env_, napi_get_value_string_utf8(env_, s, scratch_.data(), len + 1, &len));
        }
        std::string_view out{scratch_.data(), len};
        check_well_formed(s, out);
        return out;
    }

    // A lone surrogate has no UTF-8 form, and napi_get_value_string_utf8 silently turns it
    // into U+FFFD. Like @btoon/js, reject it instead. Only strings whose UTF-8 contains
    // U+FFFD (EF BF BD) need the UTF-16 check, so the common path stays one scan.
    void check_well_formed(Napi::Value s, std::string_view u8) {
        if (u8.find("\xEF\xBF\xBD") == std::string_view::npos) return;
        size_t n = 0;
        check(env_, napi_get_value_string_utf16(env_, s, nullptr, 0, &n));
        std::u16string u16(n + 1, u'\0');
        check(env_, napi_get_value_string_utf16(env_, s, u16.data(), n + 1, &n));
        for (size_t i = 0; i < n; ++i) {
            const char16_t c = u16[i];
            if (c < 0xD800 || c > 0xDFFF) continue;
            if (c <= 0xDBFF && i + 1 < n && u16[i + 1] >= 0xDC00 && u16[i + 1] <= 0xDFFF) {
                ++i;
                continue;
            }
            throw_btoon(env_, "invalid_utf8", "string contains a lone surrogate and cannot be encoded as UTF-8");
        }
    }

    // --- binary, dates, timestamps, extensions -----------------------------------------------

    // Float32Array and Float64Array are vectors; every other view is binary, with its bytes as
    // they are in memory (a Float16Array included).
    BTOON_NOINLINE void encode_view(Napi::Object o) {
        if (o.IsTypedArray()) {
            TypedBytes t = typed_array_bytes(env_, o);
            if (t.type == napi_float32_array) return encode_vector<float>(t.bytes.data(), t.length);
            if (t.type == napi_float64_array) return encode_vector<double>(t.bytes.data(), t.length);
            return enc_.encodeBinary(t.bytes);
        }
        enc_.encodeBinary(dataview_bytes(env_, o));
    }

    // An ArrayBuffer, or a SharedArrayBuffer, which Node-API reads through a Uint8Array.
    BTOON_NOINLINE void encode_buffer(Napi::Object o) {
        if (o.IsArrayBuffer()) return enc_.encodeBinary(arraybuffer_bytes(env_, o));
        enc_.encodeBinary(typed_array_bytes(env_, d_->BytesOf.Call({o})).bytes);
    }

    template <class T>
    void encode_vector(const uint8_t* bytes, size_t count) {
        // Copy out: the typed array may be unaligned within its buffer.
        std::vector<T> tmp(count);
        if (count) std::memcpy(tmp.data(), bytes, count * sizeof(T));
        if constexpr (sizeof(T) == 4) {
            enc_.encodeVectorFloat(std::span<const float>(tmp));
        } else {
            enc_.encodeVectorDouble(std::span<const double>(tmp));
        }
    }

    // A Date of any realm. A Proxy of one, or an object that only claims to be one, has no time
    // value: "expected a Date", as in @btoon/js.
    BTOON_NOINLINE void encode_date(Napi::Object o) {
        bool is_date = false;
        check(env_, napi_is_date(env_, o, &is_date));
        if (!is_date) throw_btoon(env_, "invalid_argument", "expected a Date");
        double ms = 0;
        check(env_, napi_get_date_value(env_, o, &ms));
        if (!std::isfinite(ms)) throw_btoon(env_, "invalid_argument", "cannot encode an invalid Date");
        enc_.encodeTimestamp(Timestamp::from_milliseconds(static_cast<int64_t>(ms)));
    }

    // Timestamp, BtoonDate, BtoonDateTime and Ext fields are writable, so they're checked here,
    // as @btoon/js does: a value out of range used to wrap silently (Ext type 300 became 44).
    static bool is_integer_in(Napi::Value v, double lo, double hi) {
        if (!v.IsNumber()) return false;
        double d = v.As<Napi::Number>().DoubleValue();
        return d >= lo && d <= hi && d == std::trunc(d);
    }

    BTOON_NOINLINE void encode_timestamp(Napi::Object o) {
        Napi::Value seconds = o.Get("seconds");
        Napi::Value nanos = o.Get("nanoseconds");
        Napi::Value off = o.Get("offsetMinutes");
        bool lossless = false;
        int64_t secs = seconds.IsBigInt() ? seconds.As<Napi::BigInt>().Int64Value(&lossless) : 0;
        if (!lossless) throw_btoon(env_, "invalid_argument", "Timestamp seconds must be a bigint in the int64 range");
        if (!is_integer_in(nanos, 0, 999999999)) {
            throw_btoon(env_, "invalid_argument", "Timestamp nanoseconds must be an integer in [0, 999999999]");
        }
        const auto ns = static_cast<uint32_t>(nanos.As<Napi::Number>().Int64Value());
        if (off.IsUndefined()) return enc_.encodeTimestamp(Timestamp(secs, ns));
        if (!is_integer_in(off, -1080, 1080)) {
            throw_btoon(env_, "invalid_argument", "Timestamp offsetMinutes must be an integer in [-1080, 1080]");
        }
        enc_.encodeTimestamp(Timestamp(secs, ns, static_cast<int16_t>(off.As<Napi::Number>().Int32Value())));
    }

    // A BtoonDate (date, -2) or BtoonDateTime (datetime, -3): fixext 8 holding the i64 epoch value.
    BTOON_NOINLINE void encode_epoch(Napi::Object o, bool datetime) {
        Napi::Value v = o.Get(datetime ? "epochNanoseconds" : "epochMilliseconds");
        bool lossless = false;
        int64_t epoch = v.IsBigInt() ? v.As<Napi::BigInt>().Int64Value(&lossless) : 0;
        if (!lossless) {
            throw_btoon(env_, "invalid_argument",
                        datetime ? "BtoonDateTime epochNanoseconds must be a bigint in the int64 range"
                                 : "BtoonDate epochMilliseconds must be a bigint in the int64 range");
        }
        if (datetime) return enc_.encodeDateTime(epoch);
        enc_.encodeDate(epoch);
    }

    // The ids BTOON defines (-1…-6, -10) are refused (spec §5.7): those types are written from
    // their typed values, never verbatim. Ids reserved for future versions are written as given.
    BTOON_NOINLINE void encode_ext(Napi::Object o) {
        Napi::Value type = o.Get("type");
        Napi::Value data = o.Get("data");
        if (!is_integer_in(type, -128, 127)) throw_btoon(env_, "invalid_argument", "Ext type must be an integer in [-128, 127]");
        const int t = type.As<Napi::Number>().Int32Value();
        if (const char* instead = typed_instead(t)) {
            throw_btoon(env_, "invalid_argument",
                        "Ext type " + std::to_string(t) + " is defined by BTOON and can't be written raw (SPEC \xC2\xA7" "5.7); " + instead);
        }
        if (!is_uint8_array(env_, data)) throw_btoon(env_, "invalid_argument", "Ext data must be a Uint8Array");
        enc_.encodeExtension(static_cast<int8_t>(t), typed_array_bytes(env_, data).bytes);
    }

    // --- maps ------------------------------------------------------------------------------

    static void sort(Keys& keys) {
        std::sort(keys.begin(), keys.end(), [](const Key& a, const Key& b) { return a.utf8 < b.utf8; });
    }

    // Object.keys(o): own enumerable string keys. Getters and Proxy traps run later, as each
    // value is read.
    BTOON_NOINLINE Keys own_keys(Napi::Object o) {
        napi_value names;
        check(env_, napi_get_all_property_names(env_, o, napi_key_own_only,
                                                static_cast<napi_key_filter>(napi_key_enumerable | napi_key_skip_symbols),
                                                napi_key_numbers_to_strings, &names));
        uint32_t n = 0;
        check(env_, napi_get_array_length(env_, names, &n));
        Keys keys;
        keys.reserve(n);
        for (uint32_t i = 0; i < n; ++i) {
            napi_value k;
            check(env_, napi_get_element(env_, names, i, &k));
            keys.push_back({std::string(utf8(Napi::Value(env_, k))), k});
        }
        return keys;
    }

    // A Map's keys, from index.js's mapKeys(): nullopt if one isn't a string.
    BTOON_NOINLINE std::optional<Keys> map_keys(Napi::Object m, Kind kind) {
        Napi::Value list = d_->MapKeys.Call({m, Napi::Number::New(env_, kind)});
        if (!list.IsArray()) return std::nullopt;
        Napi::Array a = list.As<Napi::Array>();
        const uint32_t n = a.Length();
        Keys keys;
        keys.reserve(n);
        for (uint32_t i = 0; i < n; ++i) {
            napi_value k;
            check(env_, napi_get_element(env_, a, i, &k));
            keys.push_back({std::string(utf8(Napi::Value(env_, k))), k});
        }
        return keys;
    }

    // The keys of a value that encodes as a map, or nullopt.
    std::optional<Keys> row_keys(Napi::Value v, Kind kind) {
        if (kind == K_PLAIN || kind == K_OBJECT) return own_keys(v.As<Napi::Object>());
        if (kind == K_MAP || kind == K_PROXY_MAP) return map_keys(v.As<Napi::Object>(), kind);
        return std::nullopt;
    }

    // The value of a map-like value at `key`; `kind` is its kind.
    Napi::Value entry(napi_value m, Kind kind, napi_value key) {
        if (kind == K_MAP || kind == K_PROXY_MAP) {
            return d_->MapGet.Call({Napi::Value(env_, m), Napi::Number::New(env_, kind), Napi::Value(env_, key)});
        }
        napi_value v;
        check(env_, napi_get_property(env_, m, key, &v));  // getters and Proxy traps run here
        return Napi::Value(env_, v);
    }

    void plain_map(Napi::Object o, size_t depth) {
        check_depth(depth);
        Keys keys = own_keys(o);
        sort(keys);
        enc_.encodeMapHeader(keys.size());
        for (const Key& k : keys) {
            enc_.encodeString(k.utf8);
            any(entry(o, K_PLAIN, k.js), depth + 1, true);
        }
    }

    void map_object(Napi::Object m, Kind kind, size_t depth) {
        check_depth(depth);
        std::optional<Keys> keys = map_keys(m, kind);
        if (!keys) throw_btoon(env_, "invalid_argument", "Map keys must be strings");
        sort(*keys);
        enc_.encodeMapHeader(keys->size());
        for (const Key& k : *keys) {
            enc_.encodeString(k.utf8);
            any(entry(m, kind, k.js), depth + 1, true);
        }
    }

    // --- arrays and tables -------------------------------------------------------------------

    napi_value element(Napi::Object arr, uint32_t i) {
        napi_value v;
        check(env_, napi_get_element(env_, arr, i, &v));
        return v;
    }

    // The length of an array, or of a Proxy of one (read through the proxy, as JS would).
    BTOON_NOINLINE uint32_t array_length(Napi::Object arr) {
        bool is_array = false;
        check(env_, napi_is_array(env_, arr, &is_array));
        uint32_t n = 0;
        if (is_array) {
            check(env_, napi_get_array_length(env_, arr, &n));
            return n;
        }
        Napi::Value v = arr.Get("length");
        double d = v.IsNumber() ? v.As<Napi::Number>().DoubleValue() : -1;
        if (!(d >= 0 && d <= 4294967295.0 && d == std::trunc(d))) {
            throw_btoon(env_, "invalid_argument", "an array length must be an integer in [0, 2^32-1]");
        }
        return static_cast<uint32_t>(d);
    }

    void array(Napi::Object arr, size_t depth) {
        check_depth(depth);
        const uint32_t n = array_length(arr);
        std::vector<napi_value> items;  // what try_tabular() resolved, when it declines
        uint32_t resolved_up_to = 0;
        if (tabular_ && n >= 2 && try_tabular(arr, n, depth, items, resolved_up_to)) return;
        enc_.encodeArrayHeader(n);
        for (uint32_t i = 0; i < n; ++i) {
            if (i < resolved_up_to) {
                any(Napi::Value(env_, items[i]), depth + 1, false);
            } else {
                any(Napi::Value(env_, element(arr, i)), depth + 1, true);
            }
        }
    }

    // The same key set as the first row's: in the same order, or else as sets (keys are unique).
    static bool same_keys(const Keys& keys, const Keys& first, std::unordered_set<std::string>& first_set) {
        if (keys.size() != first.size()) return false;
        for (size_t k = 0; k < keys.size(); ++k) {
            if (keys[k].utf8 == first[k].utf8) continue;
            if (first_set.empty()) {
                for (const Key& f : first) first_set.insert(f.utf8);
            }
            for (const Key& key : keys) {
                if (first_set.count(key.utf8) == 0) return false;
            }
            return true;
        }
        return true;
    }

    // SPEC §5.6.2, as @btoon/js's planTabular(): ≥ 2 elements that encode as maps (plain
    // objects, class instances, Maps, toJSON() results) with the same non-empty key set, and
    // the size rule. Elements with toJSON() are resolved here, once. The table is written from
    // the rows as planned, so code that runs while it is written (getters, toJSON()) can't swap
    // or remove a row. When it declines, items[0..resolved_up_to) holds the elements already
    // resolved, so the plain path doesn't call toJSON() twice.
    BTOON_NOINLINE bool try_tabular(Napi::Object arr, uint32_t n, size_t depth, std::vector<napi_value>& items,
                                    uint32_t& resolved_up_to) {
        std::vector<napi_value> rows;  // both allocated once the first element qualifies (or has toJSON())
        std::vector<Kind> kinds;
        bool resolved_any = false;
        Keys first;
        std::unordered_set<std::string> first_set;
        auto decline = [&](uint32_t up_to) {
            if (resolved_any) {
                items = std::move(rows);
                resolved_up_to = up_to;
            }
            return false;
        };
        for (uint32_t i = 0; i < n; ++i) {
            Napi::Value row(env_, element(arr, i));
            Kind kind = kind_of_value(row);
            if (kind == K_TOJSON) {
                row = call_to_json(row.As<Napi::Object>());
                kind = kind_of_value(row);
                if (kind == K_TOJSON) kind = K_OBJECT;  // no second toJSON()
                resolved_any = true;
            }
            std::optional<Keys> keys = row_keys(row, kind);
            bool ok = keys.has_value();
            if (ok) {
                if (i == 0) {
                    first = std::move(*keys);
                    ok = !first.empty();
                } else {
                    ok = same_keys(*keys, first, first_set);
                }
            }
            if (ok || resolved_any) {
                if (rows.empty()) rows.resize(n);  // every earlier element qualified, so this is the first
                rows[i] = row;
            }
            if (!ok) return decline(i + 1);
            if (kinds.empty()) kinds.resize(n);
            kinds[i] = kind;
        }
        sort(first);
        std::vector<size_t> lengths;
        std::vector<std::string_view> names;
        for (const Key& k : first) {
            lengths.push_back(k.utf8.size());
            names.push_back(k.utf8);
        }
        if (!btoon::tabular_beneficial(n, lengths)) return decline(n);
        if (depth + 1 >= max_depth_) max_depth_exceeded();
        // Core reads each column's type code off the encoding of its first cell (spec §5.6.1).
        enc_.beginTabular(names, n);
        for (const Key& k : first) {
            enc_.beginTabularColumn();
            for (uint32_t r = 0; r < n; ++r) any(entry(rows[r], kinds[r], k.js), depth + 2, true);
            enc_.endTabularColumn();
        }
        enc_.endTabular();
        return true;
    }

    Napi::Env env_;
    Encoder& enc_;
    size_t max_depth_;
    bool tabular_;
    AddonData* d_;
    std::string scratch_;
    napi_value to_json_key_ = nullptr;
};

// --- bytes -> JS ----------------------------------------------------------------------------

struct DecodeCtx {
    Napi::Env env;
    AddonData* d;
    bool timestamps_as_objects;
    bool bigint_always;
    std::unordered_map<std::string_view, Napi::Value> keys;  // repeated keys share one JS string
};

// An integer's JavaScript type depends on its value, never on how it was encoded (spec §7), as
// in @btoon/js. bigint: 'auto' gives a number for a safe integer; 'always' gives one only in
// [-2^31, 2^32-1], what a canonical encoder writes without a 64-bit marker or a bigint extension.
Napi::Value int_to_js(DecodeCtx& c, int64_t v) {
    const bool number = c.bigint_always ? v >= -2147483648LL && v <= 4294967295LL : v >= -9007199254740991LL && v <= 9007199254740991LL;
    if (number) return Napi::Number::New(c.env, static_cast<double>(v));
    return Napi::BigInt::New(c.env, v);
}

Napi::Value bigint_to_js(DecodeCtx& c, const std::vector<uint8_t>& twos) {
    // A bigint extension holding a 64-bit value (non-canonical, but valid) is still just an
    // integer: give it the same JS type the canonical encoding would get.
    BigInt as_big{twos};
    std::vector<uint8_t> minimal = as_big.minimal_bytes();
    if (minimal.size() <= 8) {
        uint64_t v = (minimal[0] & 0x80) ? ~uint64_t(0) : 0;
        for (uint8_t byte : minimal) v = (v << 8) | byte;
        return int_to_js(c, static_cast<int64_t>(v));
    }
    std::vector<uint8_t> b = twos;
    bool negative = !b.empty() && (b[0] & 0x80);
    if (negative) {  // magnitude = -value
        for (auto& x : b) x = static_cast<uint8_t>(~x);
        for (size_t j = b.size(); j-- > 0;) {
            if (++b[j] != 0) break;
        }
    }
    std::vector<uint64_t> words((b.size() + 7) / 8, 0);
    for (size_t i = 0; i < b.size(); ++i) {
        size_t bit = (b.size() - 1 - i) * 8;
        words[bit / 64] |= uint64_t(b[i]) << (bit % 64);
    }
    if (words.empty()) words.push_back(0);
    return Napi::BigInt::New(c.env, negative ? 1 : 0, words.size(), words.data());
}

// Date's range is ±8.64e15 ms around the epoch.
constexpr int64_t kMaxDateMs = 8'640'000'000'000'000;

// A Date (timestamps: 'date', the default) if the instant is within Date's range, otherwise a
// Timestamp, as @btoon/js does. Valid documents carry instants beyond it (an INT64_MAX "never"
// sentinel, seconds = 1e13), and these used to decode to Invalid Date, losing the value.
Napi::Value instant_to_js(DecodeCtx& c, int64_t seconds, uint32_t nanos, std::optional<int16_t> offset) {
    if (!c.timestamps_as_objects && seconds >= -kMaxDateMs / 1000 && seconds <= kMaxDateMs / 1000) {
        const int64_t ms = seconds * 1000 + nanos / 1000000;  // floor: nanos >= 0
        if (ms >= -kMaxDateMs && ms <= kMaxDateMs) return Napi::Date::New(c.env, static_cast<double>(ms));
    }
    Napi::Value off = offset ? Napi::Value(Napi::Number::New(c.env, *offset)) : c.env.Undefined();
    return c.d->Timestamp.New({Napi::BigInt::New(c.env, seconds), Napi::Number::New(c.env, nanos), off});
}

template <class T>
Napi::Value vector_to_js(DecodeCtx& c, const std::vector<T>& v) {
    Napi::ArrayBuffer ab = Napi::ArrayBuffer::New(c.env, v.size() * sizeof(T));
    if (!v.empty()) std::memcpy(ab.Data(), v.data(), v.size() * sizeof(T));
    if constexpr (sizeof(T) == 4) {
        return Napi::Float32Array::New(c.env, v.size(), ab, 0);
    } else {
        return Napi::Float64Array::New(c.env, v.size(), ab, 0);
    }
}

Napi::Value to_js(DecodeCtx& c, const Value& v) {
    switch (v.index()) {
        case 0: return c.env.Null();
        case 1: return Napi::Boolean::New(c.env, std::get<Bool>(v));
        case 2: return int_to_js(c, std::get<Int>(v));
        case 3: return Napi::BigInt::New(c.env, std::get<Uint>(v));
        case 4: return Napi::Number::New(c.env, std::get<Float>(v));
        case 5: {
            const auto& s = std::get<String>(v);
            return Napi::String::New(c.env, s.data(), s.size());
        }
        case 6: {
            const auto& b = std::get<Binary>(v);
            return Napi::Buffer<uint8_t>::Copy(c.env, b.data(), b.size());
        }
        case 7: {
            const auto& a = std::get<Array>(v);
            Napi::Array out = Napi::Array::New(c.env, a.size());
            for (size_t i = 0; i < a.size(); ++i) out.Set(static_cast<uint32_t>(i), to_js(c, a[i]));
            return out;
        }
        case 8: {
            // One napi_define_properties call per object. Defining (not assigning) also makes a
            // "__proto__" key an own property instead of changing the prototype.
            const auto& m = std::get<Map>(v);
            std::vector<napi_property_descriptor> props(m.size());
            size_t i = 0;
            for (const auto& [k, e] : m) {
                napi_value key;
                auto it = c.keys.find(k);
                if (it != c.keys.end()) {
                    key = it->second;
                } else {
                    key = Napi::String::New(c.env, k.data(), k.size());
                    if (c.keys.size() < 8192) c.keys.emplace(std::string_view(k), Napi::Value(c.env, key));
                }
                props[i++] = {nullptr, key, nullptr, nullptr, nullptr, to_js(c, e), napi_default_jsproperty, nullptr};
            }
            napi_value out;
            check(c.env, napi_create_object(c.env, &out));
            if (!props.empty()) check(c.env, napi_define_properties(c.env, out, props.size(), props.data()));
            return Napi::Value(c.env, out);
        }
        case 9: {
            const auto& e = std::get<Extension>(v);
            return c.d->Ext.New({Napi::Number::New(c.env, e.type),
                                 Napi::Buffer<uint8_t>::Copy(c.env, e.data.data(), e.data.size())});
        }
        case 10: {
            const auto& ts = std::get<Timestamp>(v);
            std::optional<int16_t> off;
            if (ts.has_timezone) off = ts.timezone_offset;
            return instant_to_js(c, ts.seconds, ts.nanoseconds, off);
        }
        case 11: {
            // A BtoonDate keeps the type (spec §10). With timestamps: 'date', a Date if it fits.
            const int64_t ms = std::get<Date>(v).milliseconds;
            if (!c.timestamps_as_objects && ms >= -kMaxDateMs && ms <= kMaxDateMs) return Napi::Date::New(c.env, static_cast<double>(ms));
            return c.d->BtoonDate.New({Napi::BigInt::New(c.env, ms)});
        }
        case 12: {
            // Every datetime (±2^63 ns, about ±292 years) is within the range of Date.
            const int64_t ns = std::get<DateTime>(v).nanoseconds;
            if (c.timestamps_as_objects) return c.d->BtoonDateTime.New({Napi::BigInt::New(c.env, ns)});
            int64_t ms = ns / 1000000;
            if (ns % 1000000 < 0) --ms;  // floor
            return Napi::Date::New(c.env, static_cast<double>(ms));
        }
        case 13: return bigint_to_js(c, std::get<BigInt>(v).bytes);
        case 14: return vector_to_js(c, std::get<VectorFloat>(v).data);
        case 15: return vector_to_js(c, std::get<VectorDouble>(v).data);
    }
    return c.env.Undefined();
}

// --- options -------------------------------------------------------------------------------

CompressionAlgorithm parse_algorithm(Napi::Env env, const std::string& name) {
    if (name == "zlib") return CompressionAlgorithm::ZLIB;
    if (name == "lz4") return CompressionAlgorithm::LZ4;
    if (name == "zstd") return CompressionAlgorithm::ZSTD;
    if (name == "brotli") return CompressionAlgorithm::BROTLI;
    if (name == "snappy") return CompressionAlgorithm::SNAPPY;
    throw_btoon(env, "invalid_argument", "unknown compression algorithm: '" + name + "'");
}

// The HMAC key (SPEC §8). Only an absent key (undefined) means "no key". null and an empty key
// are misconfigurations that would otherwise turn signing or verification off, so they're
// invalid_argument, as in @btoon/js. index.js checks first; this covers direct native calls.
std::optional<std::string> hmac_key_option(Napi::Env env, Napi::Value v) {
    if (v.IsUndefined()) return std::nullopt;
    if (!v.IsTypedArray()) throw_btoon(env, "invalid_argument", "hmacKey must be a Uint8Array");
    auto bytes = typed_array_bytes(env, v).bytes;
    if (bytes.empty()) throw_btoon(env, "invalid_argument", "hmacKey must not be empty (omit it for no key)");
    return std::string(reinterpret_cast<const char*>(bytes.data()), bytes.size());
}

// A limit index.js has already checked: a non-negative safe integer. One beyond size_t (on a
// 32-bit build) means no limit; it must never wrap to a small one.
size_t limit_option(Napi::Env env, Napi::Object o, const char* name) {
    Napi::Value v = o.Get(name);
    const double d = v.IsNumber() ? v.As<Napi::Number>().DoubleValue() : -1;
    if (!(d >= 0 && d == std::trunc(d))) throw_btoon(env, "invalid_argument", std::string(name) + " must be a non-negative integer");
    if (d >= static_cast<double>(SIZE_MAX)) return SIZE_MAX;
    return static_cast<size_t>(d);
}

// SPEC §7: a deeper limit would let input, or a deep value, exhaust the native stack.
size_t max_depth_option(Napi::Env env, Napi::Object o) {
    const size_t depth = limit_option(env, o, "maxDepth");
    if (depth > kMaxDepthLimit) {
        throw_btoon(env, "invalid_argument", "maxDepth must be at most " + std::to_string(kMaxDepthLimit));
    }
    return depth;
}

EncodeOptions encode_options(Napi::Env env, Napi::Object o) {
    EncodeOptions opts;
    opts.compress = o.Get("compress").ToBoolean().Value();
    opts.compression_algorithm = parse_algorithm(env, o.Get("compression").As<Napi::String>().Utf8Value());
    opts.auto_tabular = o.Get("autoTabular").ToBoolean().Value();
    opts.max_depth = max_depth_option(env, o);
    opts.hmac_key = hmac_key_option(env, o.Get("hmacKey"));
    opts.validate_utf8 = false;  // N-API strings are always well-formed UTF-8
    return opts;
}

DecodeOptions decode_options(Napi::Env env, Napi::Object o) {
    DecodeOptions opts;
    opts.strict = o.Get("strict").ToBoolean().Value();
    opts.max_depth = max_depth_option(env, o);
    opts.max_decompressed_size = limit_option(env, o, "maxDecompressedSize");
    opts.max_values = limit_option(env, o, "maxValues");
    opts.auto_decompress = o.Get("autoDecompress").ToBoolean().Value();
    opts.hmac_key = hmac_key_option(env, o.Get("hmacKey"));
    return opts;
}

std::vector<uint8_t> encode_bare(Napi::Env env, Napi::Value value, const EncodeOptions& opts) {
    Encoder enc(opts);
    JsEncoder walker(env, enc, opts.max_depth, opts.auto_tabular);
    try {
        walker.encode(value);
        return enc.release();
    } catch (const BtoonException& e) {
        throw_btoon(env, e.code_name(), e.what());
    }
}

std::span<const uint8_t> input_bytes(Napi::Env env, Napi::Value v) {
    if (v.IsTypedArray()) return typed_array_bytes(env, v).bytes;
    if (v.IsArrayBuffer()) return arraybuffer_bytes(env, v);
    if (v.IsDataView()) return dataview_bytes(env, v);
    throw_btoon(env, "invalid_argument", "decode() expects a Uint8Array, ArrayBuffer or other ArrayBufferView");
}

// --- entry points ---------------------------------------------------------------------------

// Napi::Error propagates to JS by itself; anything else (e.g. std::bad_alloc) must not
// escape into Node-API, where it would terminate the process.
template <Napi::Value (*F)(const Napi::CallbackInfo&)>
Napi::Value guarded(const Napi::CallbackInfo& info) {
    try {
        return F(info);
    } catch (const Napi::Error&) {
        throw;
    } catch (const BtoonException& e) {
        throw_btoon(info.Env(), e.code_name(), e.what());
    } catch (const std::exception& e) {
        throw Napi::Error::New(info.Env(), std::string("btoon: ") + e.what());
    }
}

Napi::Value Encode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    EncodeOptions opts = encode_options(env, info[1].As<Napi::Object>());
    std::vector<uint8_t> out = encode_bare(env, info[0], opts);
    if (opts.compress || opts.hmac_key) {
        try {
            out = btoon::apply_envelopes(std::move(out), opts);
        } catch (const BtoonException& e) {
            throw_btoon(env, e.code_name(), e.what());
        }
    }
    return Napi::Buffer<uint8_t>::Copy(env, out.data(), out.size());
}

// The options that shape decode's JS output, read once on the main thread.
struct OutputOptions {
    bool timestamps_as_objects;
    bool bigint_always;
};

OutputOptions output_options(Napi::Object o) {
    return {o.Get("timestamps").As<Napi::String>().Utf8Value() == "object",
            o.Get("bigint").As<Napi::String>().Utf8Value() == "always"};
}

DecodeCtx make_ctx(Napi::Env env, OutputOptions o) {
    return DecodeCtx{env, data_of(env), o.timestamps_as_objects, o.bigint_always, {}};
}

Napi::Value Decode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object o = info[1].As<Napi::Object>();
    DecodeOptions opts = decode_options(env, o);
    std::span<const uint8_t> in = input_bytes(env, info[0]);
    Value value;
    try {
        value = btoon::decode(in, opts);
    } catch (const BtoonException& e) {
        throw_btoon(env, e.code_name(), e.what());
    }
    DecodeCtx ctx = make_ctx(env, output_options(o));
    return to_js(ctx, value);
}

// Settles an async call's promise from OnOK/OnError. If the result can't be converted (e.g.
// out of memory), the promise is rejected instead. While the environment is being torn down
// (worker.terminate()) nothing can run: the resulting Napi::Error reaches node-addon-api,
// which drops it (NODE_API_SWALLOW_UNTHROWABLE_EXCEPTIONS) and the promise is never settled.
template <class F>
void settle(Napi::Env env, Napi::Promise::Deferred& deferred, F&& resolve) {
    try {
        resolve();
    } catch (const Napi::Error& e) {
        deferred.Reject(e.Value());
    } catch (const std::exception& e) {
        deferred.Reject(Napi::Error::New(env, std::string("btoon: ") + e.what()).Value());
    }
}

// Rejects with a BtoonError carrying the spec error code the worker recorded.
void reject_btoon(Napi::Env env, Napi::Promise::Deferred& deferred, const std::string& code, const Napi::Error& e) {
    settle(env, deferred, [&] {
        deferred.Reject(data_of(env)->BtoonError.New({Napi::String::New(env, code), e.Value().Get("message")}));
    });
}

// decodeAsync: parse on the libuv thread pool, convert on the main thread. Everything the
// worker needs is captured as plain values when it is queued, so its callbacks never read
// JS objects (which may be gone by then).
class DecodeWorker : public Napi::AsyncWorker {
public:
    DecodeWorker(Napi::Env env, std::vector<uint8_t> input, DecodeOptions opts, OutputOptions output)
        : Napi::AsyncWorker(env), deferred_(Napi::Promise::Deferred::New(env)), input_(std::move(input)),
          opts_(std::move(opts)), output_(output) {}
    Napi::Promise Promise() { return deferred_.Promise(); }

    void Execute() override {
        try {
            value_ = btoon::decode(input_, opts_);
        } catch (const BtoonException& e) {
            code_ = e.code_name();
            SetError(e.what());
        }
    }
    void OnOK() override {
        Napi::Env env = Env();
        settle(env, deferred_, [&] {
            DecodeCtx ctx = make_ctx(env, output_);
            deferred_.Resolve(to_js(ctx, value_));
        });
    }
    void OnError(const Napi::Error& e) override { reject_btoon(Env(), deferred_, code_, e); }

private:
    Napi::Promise::Deferred deferred_;
    std::vector<uint8_t> input_;
    DecodeOptions opts_;
    OutputOptions output_;
    Value value_;
    std::string code_ = "error";
};

Napi::Value DecodeAsync(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object o = info[1].As<Napi::Object>();
    DecodeOptions opts = decode_options(env, o);
    std::span<const uint8_t> in = input_bytes(env, info[0]);
    // Copy: the caller may mutate their buffer while we work off-thread.
    auto* worker = new DecodeWorker(env, std::vector<uint8_t>(in.begin(), in.end()), std::move(opts), output_options(o));
    Napi::Promise p = worker->Promise();
    worker->Queue();
    return p;
}

// encodeAsync: the value walk must run on the main thread; envelopes run off-thread.
class EnvelopeWorker : public Napi::AsyncWorker {
public:
    EnvelopeWorker(Napi::Env env, std::vector<uint8_t> bare, EncodeOptions opts)
        : Napi::AsyncWorker(env), deferred_(Napi::Promise::Deferred::New(env)), bytes_(std::move(bare)),
          opts_(std::move(opts)) {}
    Napi::Promise Promise() { return deferred_.Promise(); }
    void Execute() override {
        try {
            bytes_ = btoon::apply_envelopes(std::move(bytes_), opts_);
        } catch (const BtoonException& e) {
            code_ = e.code_name();
            SetError(e.what());
        }
    }
    void OnOK() override {
        settle(Env(), deferred_, [&] { deferred_.Resolve(Napi::Buffer<uint8_t>::Copy(Env(), bytes_.data(), bytes_.size())); });
    }
    void OnError(const Napi::Error& e) override { reject_btoon(Env(), deferred_, code_, e); }

private:
    Napi::Promise::Deferred deferred_;
    std::vector<uint8_t> bytes_;
    EncodeOptions opts_;
    std::string code_ = "error";
};

Napi::Value EncodeAsync(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    EncodeOptions opts = encode_options(env, info[1].As<Napi::Object>());
    std::vector<uint8_t> bare = encode_bare(env, info[0], opts);
    auto* worker = new EnvelopeWorker(env, std::move(bare), opts);
    Napi::Promise p = worker->Promise();
    worker->Queue();
    return p;
}

Napi::Value Setup(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object o = info[0].As<Napi::Object>();
    auto fn = [&](const char* name) { return Napi::Persistent(o.Get(name).As<Napi::Function>()); };
    auto* d = new AddonData();
    d->BtoonError = fn("BtoonError");
    d->Ext = fn("Ext");
    d->Timestamp = fn("Timestamp");
    d->BtoonDate = fn("BtoonDate");
    d->BtoonDateTime = fn("BtoonDateTime");
    d->Classify = fn("classify");
    d->Unbox = fn("unbox");
    d->MapKeys = fn("mapKeys");
    d->MapGet = fn("mapGet");
    d->BytesOf = fn("bytesOf");
    d->TypedArrayByteLength = fn("typedArrayByteLength");
    d->ObjectPrototype = Napi::Persistent(o.Get("objectPrototype").As<Napi::Object>());
    env.SetInstanceData(d);  // deleted with the environment (worker threads get their own)
    return env.Undefined();
}

Napi::Value CompressionAvailable(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return Napi::Boolean::New(env, btoon::compression_available(parse_algorithm(env, info[0].As<Napi::String>().Utf8Value())));
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("setup", Napi::Function::New(env, guarded<Setup>));
    exports.Set("encode", Napi::Function::New(env, guarded<Encode>));
    exports.Set("decode", Napi::Function::New(env, guarded<Decode>));
    exports.Set("encodeAsync", Napi::Function::New(env, guarded<EncodeAsync>));
    exports.Set("decodeAsync", Napi::Function::New(env, guarded<DecodeAsync>));
    exports.Set("compressionAvailable", Napi::Function::New(env, guarded<CompressionAvailable>));
    exports.Set("coreVersion", Napi::String::New(env, btoon::version()));
    exports.Set("specVersion", Napi::String::New(env, btoon::spec_version()));
    // Core's limits (SPEC §7, §7.1), so index.js's defaults can't drift from them.
    exports.Set("defaultMaxDepth", Napi::Number::New(env, static_cast<double>(kDefaultMaxDepth)));
    exports.Set("maxDepthLimit", Napi::Number::New(env, static_cast<double>(kMaxDepthLimit)));
    exports.Set("defaultMaxDecompressedSize", Napi::Number::New(env, static_cast<double>(kDefaultMaxDecompressedSize)));
    exports.Set("defaultMaxValues", Napi::Number::New(env, static_cast<double>(kDefaultMaxValues)));
    return exports;
}

}  // namespace

NODE_API_MODULE(btoon, Init)
