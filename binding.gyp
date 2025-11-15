{
  "targets": [
    {
      "target_name": "btoon",
      "sources": ["btoon_node.cpp"],
      "include_dirs": [
        "node_modules/node-addon-api",
        "<!@(node find_btoon_core.js)",
        "../btoon-core/include",
        "/usr/local/include"
      ],
      "libraries": [
        "-lbtoon_core",
        "-lz"
      ],
      "library_dirs": [
        "<!@(node find_btoon_lib.js)",
        "../btoon-core/build",
        "/usr/local/lib"
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "cflags_cc": ["-std=c++20"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        ["OS=='mac'", {
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "10.15",
            "OTHER_CPLUSPLUSFLAGS": ["-std=c++20"]
          }
        }],
        ["OS=='linux'", {
          "cflags_cc": ["-std=c++20", "-fPIC"]
        }],
        ["OS=='win'", {
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": ["/std:c++20"]
            }
          }
        }]
      ]
    }
  ]
}
