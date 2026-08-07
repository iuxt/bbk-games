cmake_minimum_required(VERSION 3.16)
project(gam4980 LANGUAGES C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

add_executable(gam4980
    ${CMAKE_SOURCE_DIR}/../src/web_main.c
)

target_compile_options(gam4980 PRIVATE
    -O2
    -flto
)

target_link_options(gam4980 PRIVATE
    -O2
    -flto
    "SHELL:-sEXPORTED_FUNCTIONS=[\"_web_init\",\"_web_run_frame\",\"_web_keydown\",\"_web_get_framebuffer\",\"_web_get_framebuffer_rgba\",\"_web_get_fb_width\",\"_web_get_fb_height\",\"_web_load_game\",\"_web_save_size\",\"_web_save\",\"_web_load\",\"_malloc\",\"_free\"]"
    "SHELL:-sEXPORTED_RUNTIME_METHODS=[\"ccall\",\"cwrap\",\"getValue\",\"setValue\",\"HEAPU8\",\"HEAPU16\"]"
    -sALLOW_MEMORY_GROWTH=1
    -sINITIAL_MEMORY=80MB
    -sENVIRONMENT=web
    -sMODULARIZE=1
    "SHELL:-sEXPORT_NAME=\"Gam4980Module\""
    --preload-file ${CMAKE_SOURCE_DIR}/preload@/preload
    -sFORCE_FILESYSTEM=1
    --shell-file ${CMAKE_SOURCE_DIR}/shell.html
)
