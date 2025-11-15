#include <napi.h>
#include "btoon/btoon.h"
#include <variant>
#include <span>

using namespace btoon;

using Value = btoon::Value;

// Convert Napi::Value to btoon Value (using Encoder methods)
Value napi_to_value(const Napi::Value& val) {
    if (val.IsNull() || val.IsUndefined()) {
        return Value(nullptr);
    } else if (val.IsBoolean()) {
        return Value(val.As<Napi::Boolean>().Value());
    } else if (val.IsNumber()) {
        double num = val.As<Napi::Number>().DoubleValue();
        if (num == static_cast<int64_t>(num)) {
            int64_t ival = static_cast<int64_t>(num);
            if (ival >= 0) {
                return Value(static_cast<uint64_t>(ival));
            }
            return Value(ival);
        }
        return Value(num);
    } else if (val.IsString()) {
        return Value(val.As<Napi::String>().Utf8Value());
    } else if (val.IsDate()) {
        double millis = val.As<Napi::Date>().ValueOf();
        return Value(Date{static_cast<int64_t>(millis)});
    } else if (val.IsBuffer()) {
        auto buf = val.As<Napi::Buffer<uint8_t>>();
        return Value(std::vector<uint8_t>(buf.Data(), buf.Data() + buf.Length()));
    } else if (val.IsArray()) {
        auto arr = val.As<Napi::Array>();
        std::vector<Value> vec;
        for (uint32_t i = 0; i < arr.Length(); i++) {
            vec.push_back(napi_to_value(arr.Get(i)));
        }
        return Value(vec);
    } else if (val.IsObject()) {
        auto obj = val.As<Napi::Object>();
        auto props = obj.GetPropertyNames();
        std::map<std::string, Value> map;
        for (uint32_t i = 0; i < props.Length(); i++) {
            auto key = props.Get(i).As<Napi::String>().Utf8Value();
            map[key] = napi_to_value(obj.Get(key));
        }
        return Value(map);
    }
    
    throw Napi::TypeError::New(val.Env(), "Unsupported type");
}

// Convert btoon::Value to Napi::Value
Napi::Value value_to_napi(Napi::Env env, const Value& value) {
    if (std::holds_alternative<std::nullptr_t>(value)) {
        return env.Null();
    } else if (std::holds_alternative<bool>(value)) {
        return Napi::Boolean::New(env, std::get<bool>(value));
    } else if (std::holds_alternative<int64_t>(value)) {
        return Napi::Number::New(env, static_cast<double>(std::get<int64_t>(value)));
    } else if (std::holds_alternative<uint64_t>(value)) {
        return Napi::Number::New(env, static_cast<double>(std::get<uint64_t>(value)));
    } else if (std::holds_alternative<double>(value)) {
        return Napi::Number::New(env, std::get<double>(value));
    } else if (std::holds_alternative<std::string>(value)) {
        return Napi::String::New(env, std::get<std::string>(value));
    } else if (std::holds_alternative<std::vector<uint8_t>>(value)) {
        const auto& bin = std::get<std::vector<uint8_t>>(value);
        auto buf = Napi::Buffer<uint8_t>::Copy(env, bin.data(), bin.size());
        return buf;
    } else if (std::holds_alternative<std::vector<Value>>(value)) {
        const auto& vec = std::get<std::vector<Value>>(value);
        auto arr = Napi::Array::New(env, vec.size());
        for (size_t i = 0; i < vec.size(); i++) {
            arr.Set(i, value_to_napi(env, vec[i]));
        }
        return arr;
    } else if (std::holds_alternative<std::map<std::string, Value>>(value)) {
        const auto& map = std::get<std::map<std::string, Value>>(value);
        auto obj = Napi::Object::New(env);
        for (const auto& [k, v] : map) {
            obj.Set(k, value_to_napi(env, v));
        }
        return obj;
    } else if (std::holds_alternative<Timestamp>(value)) {
        const auto& ts = std::get<Timestamp>(value);
        auto obj = Napi::Object::New(env);
        obj.Set("type", Napi::String::New(env, "timestamp"));
        obj.Set("seconds", Napi::Number::New(env, static_cast<double>(ts.seconds)));
        obj.Set("nanoseconds", Napi::Number::New(env, ts.nanoseconds));
        obj.Set("timezoneOffset", Napi::Number::New(env, ts.timezone_offset));
        obj.Set("hasTimezone", Napi::Boolean::New(env, ts.has_timezone));
        return obj;
    } else if (std::holds_alternative<Date>(value)) {
        const auto& date = std::get<Date>(value);
        return Napi::Date::New(env, static_cast<double>(date.milliseconds));
    } else if (std::holds_alternative<DateTime>(value)) {
        const auto& dt = std::get<DateTime>(value);
        double millis = static_cast<double>(dt.nanoseconds) / 1e6;
        return Napi::Date::New(env, millis);
    } else if (std::holds_alternative<Extension>(value)) {
        const auto& ext = std::get<Extension>(value);
        auto obj = Napi::Object::New(env);
        obj.Set("type", Napi::String::New(env, "extension"));
        obj.Set("extType", Napi::Number::New(env, ext.type));
        obj.Set("data", Napi::Buffer<uint8_t>::Copy(env, ext.data.data(), ext.data.size()));
        return obj;
    } else if (std::holds_alternative<BigInt>(value)) {
        const auto& big = std::get<BigInt>(value);
        return Napi::Buffer<uint8_t>::Copy(env, big.bytes.data(), big.bytes.size());
    } else if (std::holds_alternative<VectorFloat>(value)) {
        const auto& vec = std::get<VectorFloat>(value).data;
        auto arr = Napi::Array::New(env, vec.size());
        for (size_t i = 0; i < vec.size(); ++i) {
            arr.Set(i, Napi::Number::New(env, vec[i]));
        }
        return arr;
    } else if (std::holds_alternative<VectorDouble>(value)) {
        const auto& vec = std::get<VectorDouble>(value).data;
        auto arr = Napi::Array::New(env, vec.size());
        for (size_t i = 0; i < vec.size(); ++i) {
            arr.Set(i, Napi::Number::New(env, vec[i]));
        }
        return arr;
    }
    
    return env.Null();
}

// Encode function
Napi::Value Encode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1) {
        throw Napi::TypeError::New(env, "Expected at least 1 argument");
    }
    
    bool compress = false;
    bool auto_tabular = true;
    CompressionAlgorithm algorithm = CompressionAlgorithm::NONE;
    bool hasAlgorithm = false;
    
    if (info.Length() >= 2 && info[1].IsObject()) {
        auto opts = info[1].As<Napi::Object>();
        if (opts.Has("compress")) {
            compress = opts.Get("compress").As<Napi::Boolean>().Value();
        }
        if (opts.Has("autoTabular")) {
            auto_tabular = opts.Get("autoTabular").As<Napi::Boolean>().Value();
        }
        if (opts.Has("algorithm")) {
            hasAlgorithm = true;
            auto algStr = opts.Get("algorithm").As<Napi::String>().Utf8Value();
            if (algStr == "zlib") algorithm = CompressionAlgorithm::ZLIB;
            else if (algStr == "lz4") algorithm = CompressionAlgorithm::LZ4;
            else if (algStr == "zstd") algorithm = CompressionAlgorithm::ZSTD;
            else if (algStr == "brotli") algorithm = CompressionAlgorithm::BROTLI;
            else if (algStr == "snappy") algorithm = CompressionAlgorithm::SNAPPY;
            else algorithm = CompressionAlgorithm::NONE;
        }
    }
    
    try {
        Value value = napi_to_value(info[0]);
        EncodeOptions options;
        options.compress = compress;
        options.auto_tabular = auto_tabular;
        if (hasAlgorithm) {
            options.compression_algorithm = algorithm;
        }
        auto encoded = btoon::encode(value, options);
        
        return Napi::Buffer<uint8_t>::Copy(env, encoded.data(), encoded.size());
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, e.what());
    }
}

// Decode function
Napi::Value Decode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsBuffer()) {
        throw Napi::TypeError::New(env, "Expected Buffer as first argument");
    }
    
    bool decompress = false;
    bool hasDecompressOption = false;
    
    if (info.Length() >= 2 && info[1].IsObject()) {
        auto opts = info[1].As<Napi::Object>();
        if (opts.Has("decompress")) {
            decompress = opts.Get("decompress").As<Napi::Boolean>().Value();
            hasDecompressOption = true;
        }
    }
    
    try {
        auto buf = info[0].As<Napi::Buffer<uint8_t>>();
        std::span<const uint8_t> data(buf.Data(), buf.Length());
        DecodeOptions options;
        if (hasDecompressOption) {
            options.auto_decompress = decompress;
        }
        auto value = btoon::decode(data, options);
        return value_to_napi(env, value);
    } catch (const std::exception& e) {
        throw Napi::Error::New(env, e.what());
    }
}

// Version function
Napi::Value Version(const Napi::CallbackInfo& info) {
    return Napi::String::New(info.Env(), btoon::version());
}

// Module initialization
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("encode", Napi::Function::New(env, Encode));
    exports.Set("decode", Napi::Function::New(env, Decode));
    exports.Set("version", Napi::Function::New(env, Version));
    return exports;
}

NODE_API_MODULE(btoon, Init)
