// SPDX-FileCopyrightText: 2025 Alvar Laigna <https://alvarlaigna.com>
// SPDX-License-Identifier: MIT
//
// Node-API addon for BTOON. JS values are encoded straight into btoon::Encoder
// (no intermediate tree); bytes are decoded by btoon-core's hardened decoder
// into a btoon::Value and then converted to JS. The JS-facing classes
// (BtoonError, Ext, Timestamp) are defined in index.js and passed to setup().

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
    Napi::FunctionReference BtoonError, Ext, Timestamp, MapCtor, ArrayFrom, ProxyKind, TypedArrayByteLength;
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

// --- JS -> bytes ------------------------------------------------------------------------

struct Entry {
    std::string key;     // UTF-8
    Napi::Value value;
};
using Entries = std::vector<Entry>;

// How an object encodes. The values 0-3 are what proxyKind() in index.js returns.
enum class Kind : int32_t {
    Plain = 0,       // prototype Object.prototype or null: own enumerable properties, own toJSON()
    ProxyArray = 1,  // a Proxy of an array: length and elements are read through the proxy
    Other = 2,       // binary, Date, Ext, Timestamp, Map, toJSON() or a class instance
    ProxyDate = 3,   // a Proxy of a Date, which has no time value of its own
    Array = 4,       // a JS array
};

class JsEncoder {
public:
    JsEncoder(Napi::Env env, Encoder& enc, size_t max_depth, bool tabular)
        : env_(env), enc_(enc), max_depth_(max_depth), tabular_(tabular), d_(data_of(env)) {}

    // Nested values recurse through encode(), encode_object(), encode_array() and
    // encode_map_like()/encode_entries(): keep their frames small.
    void encode(Napi::Value v, size_t depth) {
        switch (v.Type()) {
            case napi_undefined:
            case napi_null: return enc_.encodeNil();
            case napi_boolean: return enc_.encodeBool(v.As<Napi::Boolean>().Value());
            case napi_number: return encode_number(v.As<Napi::Number>().DoubleValue());
            case napi_bigint: return encode_bigint(v.As<Napi::BigInt>());
            case napi_string: return encode_string(v);
            case napi_object: return encode_object(v.As<Napi::Object>(), depth);
            default: unsupported(v.Type());
        }
    }

private:
    [[noreturn]] BTOON_NOINLINE void unsupported(napi_valuetype t) {
        const char* name = t == napi_function ? "function" : t == napi_symbol ? "symbol" : t == napi_external ? "external" : "unknown";
        throw_btoon(env_, "invalid_argument", std::string("cannot encode a value of type ") + name);
    }

    BTOON_NOINLINE void encode_string(Napi::Value s) { enc_.encodeString(utf8(s)); }

    void check_depth(size_t depth) {
        if (depth >= max_depth_) throw_btoon(env_, "max_depth", "maximum nesting depth exceeded (or the value contains a cycle)");
    }

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
            throw_btoon(env_, "invalid_utf8", "string contains a lone surrogate (use String.prototype.toWellFormed())");
        }
    }

    std::string utf8_copy(Napi::Value s) { return std::string(utf8(s)); }

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

    bool instance_of(Napi::Object o, Napi::FunctionReference& ctor) {
        bool result = false;
        check(env_, napi_instanceof(env_, o, ctor.Value(), &result));  // a Proxy's getPrototypeOf trap can throw
        return result;
    }

    // Arrays and plain objects ({} literals) take at most three Node-API calls, and no call into
    // JS. napi_get_prototype never runs a Proxy's getPrototypeOf trap and reports null for every
    // Proxy, so a null prototype means Object.create(null) or a Proxy (Vue and MobX reactive
    // state). Only then does JS classify the object, with Array.isArray and
    // Object.getPrototypeOf, which see through proxies (as @btoon/js does). Treating every
    // Proxy as a plain object encoded a proxied [10, 20, 30] as {"0": 10, ...}.
    BTOON_NOINLINE Kind kind_of(Napi::Object o) {
        bool is_array = false;
        check(env_, napi_is_array(env_, o, &is_array));
        if (is_array) return Kind::Array;
        napi_value proto;
        check(env_, napi_get_prototype(env_, o, &proto));
        bool eq = false;
        check(env_, napi_strict_equals(env_, proto, d_->ObjectPrototype.Value(), &eq));
        if (eq) return Kind::Plain;
        napi_valuetype t;
        check(env_, napi_typeof(env_, proto, &t));
        if (t != napi_null) return Kind::Other;
        napi_value arg = o, kind;
        check(env_, napi_call_function(env_, env_.Undefined(), d_->ProxyKind.Value(), 1, &arg, &kind));  // traps can throw
        int32_t k = 0;
        check(env_, napi_get_value_int32(env_, kind, &k));
        return k >= 0 && k <= 3 ? static_cast<Kind>(k) : Kind::Other;
    }

    // Binary, Date, Ext and Timestamp objects have an encoding of their own. (A Proxy of a
    // typed array or a Date has none of their internal slots, so it never counts.)
    bool has_own_encoding(Napi::Object o) {
        return o.IsTypedArray() || o.IsArrayBuffer() || o.IsDataView() || o.IsDate() || instance_of(o, d_->Ext) ||
               instance_of(o, d_->Timestamp);
    }

    // The length of a Proxy of an array, read through the proxy as JS would.
    BTOON_NOINLINE uint32_t proxy_length(Napi::Object o) {
        Napi::Value v = o.Get("length");
        double n = v.IsNumber() ? v.As<Napi::Number>().DoubleValue() : -1;
        if (!(n >= 0 && n <= 4294967295.0 && n == std::trunc(n))) {
            throw_btoon(env_, "invalid_argument", "a proxied array's length must be an integer in [0, 2^32-1]");
        }
        return static_cast<uint32_t>(n);
    }

    // Getters and Proxy traps run here and may throw; their exception is rethrown as is.
    Entries own_entries(Napi::Object o) {
        napi_value names;
        check(env_, napi_get_all_property_names(env_, o, napi_key_own_only,
                                                static_cast<napi_key_filter>(napi_key_enumerable | napi_key_skip_symbols),
                                                napi_key_numbers_to_strings, &names));
        uint32_t n = 0;
        check(env_, napi_get_array_length(env_, names, &n));
        Entries out;
        out.reserve(n);
        for (uint32_t i = 0; i < n; ++i) {
            napi_value k, val;
            check(env_, napi_get_element(env_, names, i, &k));
            check(env_, napi_get_property(env_, o, k, &val));
            out.push_back({utf8_copy(Napi::Value(env_, k)), Napi::Value(env_, val)});
        }
        sort(out);
        return out;
    }

    // If `v` encodes as a BTOON map, returns its entries sorted by UTF-8 key bytes. If it has
    // toJSON(), calls it once and returns its result in `*replaced` instead.
    std::optional<Entries> map_entries(Napi::Value v, Napi::Value* replaced) {
        if (!v.IsObject()) return std::nullopt;
        Napi::Object o = v.As<Napi::Object>();
        const Kind kind = kind_of(o);
        if (kind == Kind::Plain || (kind == Kind::Other && !has_own_encoding(o))) return object_entries(o, kind, replaced);
        return std::nullopt;
    }

    // map_entries() for a plain object, or for an Other that has_own_encoding() ruled out.
    // Plain objects ({} literals, Object.create(null)) only honor an own toJSON().
    BTOON_NOINLINE std::optional<Entries> object_entries(Napi::Object o, Kind kind, Napi::Value* replaced) {
        if (kind == Kind::Plain) {
            bool has_to_json = false;
            napi_value key = Napi::String::New(env_, "toJSON");
            check(env_, napi_has_own_property(env_, o, key, &has_to_json));
            if (has_to_json) {
                Napi::Value fn = o.Get(key);
                if (fn.IsFunction()) {
                    *replaced = fn.As<Napi::Function>().Call(o, {});
                    return std::nullopt;
                }
            }
            return own_entries(o);
        }
        // Map (a proxied one too: its entries come from its own iterator, through the proxy).
        if (instance_of(o, d_->MapCtor)) {
            Napi::Array pairs = d_->ArrayFrom.Call({o}).As<Napi::Array>();
            Entries out;
            out.reserve(pairs.Length());
            for (uint32_t i = 0; i < pairs.Length(); ++i) {
                Napi::Array kv = pairs.Get(i).As<Napi::Array>();
                Napi::Value k = kv.Get(uint32_t(0));
                if (!k.IsString()) throw_btoon(env_, "invalid_argument", "Map keys must be strings");
                out.push_back({utf8_copy(k), kv.Get(uint32_t(1))});
            }
            sort(out);
            return out;
        }
        Napi::Value to_json = o.Get("toJSON");
        if (to_json.IsFunction()) {
            *replaced = to_json.As<Napi::Function>().Call(o, {});
            return std::nullopt;
        }
        return own_entries(o);
    }

    static void sort(Entries& e) {
        std::sort(e.begin(), e.end(), [](const Entry& a, const Entry& b) { return a.key < b.key; });
    }

    void encode_entries(const Entries& entries, size_t depth) {
        check_depth(depth);
        enc_.encodeMapHeader(entries.size());
        for (const Entry& e : entries) {
            enc_.encodeString(e.key);
            encode(e.value, depth + 1);
        }
    }

    // Float32Array and Float64Array are vectors; every other view is binary, with its bytes as
    // they are in memory (a Float16Array included).
    void encode_bytes(Napi::Object o) {
        if (o.IsTypedArray()) {
            TypedBytes t = typed_array_bytes(env_, o);
            if (t.type == napi_float32_array) return encode_vector<float>(t.bytes.data(), t.length);
            if (t.type == napi_float64_array) return encode_vector<double>(t.bytes.data(), t.length);
            return enc_.encodeBinary(t.bytes);
        }
        if (o.IsDataView()) return enc_.encodeBinary(dataview_bytes(env_, o));
        enc_.encodeBinary(arraybuffer_bytes(env_, o));
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

    void encode_object(Napi::Object o, size_t depth) {
        const Kind kind = kind_of(o);
        if (kind == Kind::Array || kind == Kind::ProxyArray) {
            return encode_array(o, kind == Kind::Array ? o.As<Napi::Array>().Length() : proxy_length(o), depth);
        }
        if (kind == Kind::ProxyDate) throw_btoon(env_, "invalid_argument", "cannot encode a Proxy of a Date");
        if (kind == Kind::Other && encode_own_encoding(o)) return;
        encode_map_like(o, kind, depth);
    }

    // Binary, Date, Ext or Timestamp; false for anything else.
    BTOON_NOINLINE bool encode_own_encoding(Napi::Object o) {
        if (o.IsTypedArray() || o.IsArrayBuffer() || o.IsDataView()) {
            encode_bytes(o);
        } else if (o.IsDate()) {
            double ms = o.As<Napi::Date>().ValueOf();
            if (!std::isfinite(ms)) throw_btoon(env_, "invalid_argument", "cannot encode an invalid Date");
            enc_.encodeTimestamp(Timestamp::from_milliseconds(static_cast<int64_t>(ms)));
        } else if (instance_of(o, d_->Ext)) {
            encode_ext(o);
        } else if (instance_of(o, d_->Timestamp)) {
            encode_timestamp(o);
        } else {
            return false;
        }
        return true;
    }

    void encode_map_like(Napi::Object o, Kind kind, size_t depth) {
        Napi::Value replaced;
        auto entries = object_entries(o, kind, &replaced);
        if (entries) return encode_entries(*entries, depth);
        if (replaced.IsEmpty()) throw_btoon(env_, "invalid_argument", "cannot encode this object");
        check_depth(depth);  // toJSON() chains terminate
        encode(replaced, depth + 1);
    }

    // Ext and Timestamp fields are writable, so they're checked here, as @btoon/js does: a value
    // out of range used to wrap silently (Ext type 300 became 44).
    static bool is_integer_in(Napi::Value v, double lo, double hi) {
        if (!v.IsNumber()) return false;
        double d = v.As<Napi::Number>().DoubleValue();
        return d >= lo && d <= hi && d == std::trunc(d);
    }

    // Core's encodeExtension() rejects the ids BTOON defines (-1…-6, -10) with invalid_argument
    // (SPEC §5.7), which encode_bare() turns into a BtoonError: those types are written from
    // their typed values, never verbatim.
    void encode_ext(Napi::Object o) {
        Napi::Value type = o.Get("type");
        if (!is_integer_in(type, -128, 127)) throw_btoon(env_, "invalid_argument", "Ext type must be an integer in [-128, 127]");
        Napi::Value data = o.Get("data");
        if (!data.IsTypedArray()) throw_btoon(env_, "invalid_argument", "Ext data must be a Uint8Array");
        enc_.encodeExtension(static_cast<int8_t>(type.As<Napi::Number>().Int32Value()), typed_array_bytes(env_, data).bytes);
    }

    // Seconds beyond int64 used to wrap: 2n**64n encoded as the epoch, 2n**63n as -2^63.
    void encode_timestamp(Napi::Object o) {
        Napi::Value seconds = o.Get("seconds");
        bool lossless = false;
        int64_t secs = seconds.IsBigInt() ? seconds.As<Napi::BigInt>().Int64Value(&lossless) : 0;
        if (!lossless) throw_btoon(env_, "invalid_argument", "Timestamp seconds must be a bigint in the int64 range");
        Napi::Value nanos = o.Get("nanoseconds");
        if (!is_integer_in(nanos, 0, 999999999)) {
            throw_btoon(env_, "invalid_argument", "Timestamp nanoseconds must be an integer in [0, 999999999]");
        }
        const auto ns = static_cast<uint32_t>(nanos.As<Napi::Number>().Int64Value());
        Napi::Value off = o.Get("offsetMinutes");
        if (off.IsUndefined() || off.IsNull()) return enc_.encodeTimestamp(Timestamp(secs, ns));
        if (!is_integer_in(off, -1080, 1080)) {
            throw_btoon(env_, "invalid_argument", "Timestamp offsetMinutes must be an integer in [-1080, 1080]");
        }
        enc_.encodeTimestamp(Timestamp(secs, ns, static_cast<int16_t>(off.As<Napi::Number>().Int32Value())));
    }

    // `arr` is an array, or a Proxy of one (elements are read through the proxy). A plain array
    // reuses the map entries try_tabular() computed, so getters and toJSON() run once.
    void encode_array(Napi::Object arr, uint32_t n, size_t depth) {
        check_depth(depth);
        std::vector<Napi::Value> items;
        items.reserve(n);
        for (uint32_t i = 0; i < n; ++i) items.push_back(arr.Get(i));
        std::vector<Entries> rows;
        if (tabular_ && n >= 2 && try_tabular(items, rows, depth)) return;
        enc_.encodeArrayHeader(n);
        for (size_t i = 0; i < items.size(); ++i) {
            if (i < rows.size()) {
                encode_entries(rows[i], depth + 1);
            } else {
                encode(items[i], depth + 1);
            }
        }
    }

    // SPEC §5.6.2: ≥ 2 rows, all maps (plain objects, class instances, Maps), same non-empty key set,
    // and the size rule. Writes the table and returns true; otherwise returns false with the
    // entries of the rows it got through in `rows` (and toJSON() results in `items`).
    BTOON_NOINLINE bool try_tabular(std::vector<Napi::Value>& items, std::vector<Entries>& rows, size_t depth) {
        rows.reserve(items.size());
        for (size_t r = 0; r < items.size(); ++r) {
            Napi::Value replaced;
            auto entries = map_entries(items[r], &replaced);
            if (!replaced.IsEmpty()) {
                // toJSON() ran once; its result is what gets encoded (and may itself be a map).
                items[r] = replaced;
                Napi::Value again;
                entries = map_entries(replaced, &again);
                if (!again.IsEmpty()) {
                    items[r] = again;
                    return false;
                }
            }
            if (!entries || entries->empty()) return false;
            if (r > 0) {
                const Entries& first = rows[0];
                bool same = entries->size() == first.size();
                for (size_t k = 0; same && k < first.size(); ++k) same = (*entries)[k].key == first[k].key;
                if (!same) {
                    rows.push_back(std::move(*entries));
                    return false;
                }
            }
            rows.push_back(std::move(*entries));
        }
        std::vector<size_t> lengths;
        std::vector<std::string_view> names;
        for (const Entry& e : rows[0]) {
            lengths.push_back(e.key.size());
            names.push_back(e.key);
        }
        if (!btoon::tabular_beneficial(rows.size(), lengths)) return false;
        if (depth + 1 >= max_depth_) throw_btoon(env_, "max_depth", "maximum nesting depth exceeded (or the value contains a cycle)");
        enc_.beginTabular(names, rows.size());
        for (size_t c = 0; c < names.size(); ++c) {
            enc_.beginTabularColumn();
            for (const Entries& row : rows) encode(row[c].value, depth + 2);
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
};

// --- bytes -> JS ----------------------------------------------------------------------------

struct DecodeCtx {
    Napi::Env env;
    AddonData* d;
    bool timestamps_as_objects;
    bool bigint_always;
    std::unordered_map<std::string_view, Napi::Value> keys;  // repeated keys share one JS string
};

Napi::Value int_to_js(DecodeCtx& c, int64_t v) {
    if (!c.bigint_always && v >= -9007199254740991LL && v <= 9007199254740991LL) {
        return Napi::Number::New(c.env, static_cast<double>(v));
    }
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
            int64_t ms = std::get<Date>(v).milliseconds;
            int64_t s = ms / 1000, r = ms % 1000;
            if (r < 0) { r += 1000; --s; }
            return instant_to_js(c, s, static_cast<uint32_t>(r * 1000000), std::nullopt);
        }
        case 12: {
            int64_t ns = std::get<DateTime>(v).nanoseconds;
            int64_t s = ns / 1000000000, r = ns % 1000000000;
            if (r < 0) { r += 1000000000; --s; }
            return instant_to_js(c, s, static_cast<uint32_t>(r), std::nullopt);
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
    if (name == "auto") return CompressionAlgorithm::AUTO;
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
        walker.encode(value, 0);
        return enc.release();
    } catch (const BtoonException& e) {
        throw_btoon(env, e.code_name(), e.what());
    }
}

std::span<const uint8_t> input_bytes(Napi::Env env, Napi::Value v) {
    if (v.IsTypedArray()) return typed_array_bytes(env, v).bytes;
    if (v.IsArrayBuffer()) return arraybuffer_bytes(env, v);
    if (v.IsDataView()) return dataview_bytes(env, v);
    throw_btoon(env, "invalid_argument", "decode expects a Uint8Array, Buffer, ArrayBuffer or DataView");
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
    std::span<const uint8_t> in = input_bytes(env, info[0]);
    // Copy: the caller may mutate their buffer while we work off-thread.
    auto* worker = new DecodeWorker(env, std::vector<uint8_t>(in.begin(), in.end()), decode_options(env, o),
                                    output_options(o));
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
    auto* d = new AddonData();
    d->BtoonError = Napi::Persistent(o.Get("BtoonError").As<Napi::Function>());
    d->Ext = Napi::Persistent(o.Get("Ext").As<Napi::Function>());
    d->Timestamp = Napi::Persistent(o.Get("Timestamp").As<Napi::Function>());
    d->MapCtor = Napi::Persistent(o.Get("Map").As<Napi::Function>());
    d->ArrayFrom = Napi::Persistent(o.Get("arrayFrom").As<Napi::Function>());
    d->ProxyKind = Napi::Persistent(o.Get("proxyKind").As<Napi::Function>());
    d->ObjectPrototype = Napi::Persistent(o.Get("objectPrototype").As<Napi::Object>());
    d->TypedArrayByteLength = Napi::Persistent(o.Get("typedArrayByteLength").As<Napi::Function>());
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
