cmake_minimum_required(VERSION 3.10)
project(MultiLangTest)

set(CMAKE_C_STANDARD 99)
set(CMAKE_CXX_STANDARD 17)

# C library
add_library(shapes_c STATIC 
    src/c/shapes.c
)
target_include_directories(shapes_c PUBLIC 
    ${CMAKE_SOURCE_DIR}/src/c
)

# C executable
add_executable(c_demo 
    src/c/main.c
)
target_link_libraries(c_demo shapes_c)

# C++ library
add_library(shapes_cpp STATIC 
    src/cpp/shapes.cpp
)
target_include_directories(shapes_cpp PUBLIC 
    ${CMAKE_SOURCE_DIR}/src/cpp
    ${CMAKE_SOURCE_DIR}/include
)

# C++ executable
add_executable(cpp_demo 
    src/cpp/main.cpp
)
target_link_libraries(cpp_demo shapes_cpp)
