{
  "targets": [
    {
      "target_name": "btoon",
      "sources": [
        "src/btoon_node.cpp",
        "<!@(node scripts/core-path.js sources)"
      ],
      "include_dirs": [
        "<!(node -p \"require('node-addon-api').include_dir\")",
        "<!(node scripts/core-path.js include)",
        "<!(node scripts/core-path.js src)"
      ],
      "defines": ["NAPI_VERSION=8", "NAPI_CPP_EXCEPTIONS"],
      "cflags_cc!": ["-fno-exceptions", "-fno-rtti", "-std=gnu++17", "-std=c++17"],
      "cflags_cc": ["-std=c++20", "-fexceptions", "-frtti", "-O3"],
      "conditions": [
        ["OS=='mac'", {
          "xcode_settings": {
            "CLANG_CXX_LANGUAGE_STANDARD": "c++20",
            "CLANG_CXX_LIBRARY": "libc++",
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "GCC_ENABLE_CPP_RTTI": "YES",
            "GCC_OPTIMIZATION_LEVEL": "3",
            "MACOSX_DEPLOYMENT_TARGET": "11.0"
          }
        }],
        ["OS=='win'", {
          "defines": ["NOMINMAX", "WIN32_LEAN_AND_MEAN", "_HAS_EXCEPTIONS=1"],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "AdditionalOptions": ["/std:c++20", "/EHsc", "/Zc:__cplusplus", "/permissive-"],
              "ExceptionHandling": 1,
              "RuntimeTypeInfo": "true"
            }
          }
        }]
      ]
    }
  ]
}
