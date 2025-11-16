{
  "targets": [
    {
      "target_name": "btoon",
      "sources": ["btoon_node.cpp"],
      "include_dirs": [
        "node_modules/node-addon-api"
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "cflags_cc": ["-std=c++20"],
      "conditions": [
        ["OS=='mac'", {
          "include_dirs": [
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
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "10.15",
            "OTHER_CPLUSPLUSFLAGS": ["-std=c++20"]
          }
        }],
        ["OS=='linux'", {
          "include_dirs": [
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
          "cflags_cc": ["-std=c++20", "-fPIC"]
        }],
        ["OS=='win'", {
          "include_dirs": [
            "core/include",
            "core/build/Release",
            "C:/vcpkg/installed/x64-windows/include"
          ],
          "library_dirs": [
            "core/build/Release",
            "C:/vcpkg/installed/x64-windows/lib"
          ],
          "libraries": [
            "btoon_core.lib",
            "zlib.lib",
            "ws2_32.lib"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "RuntimeLibrary": 2,
              "AdditionalOptions": ["/std:c++20", "/MD"]
            }
          }
        }]
      ]
    }
  ]
}
