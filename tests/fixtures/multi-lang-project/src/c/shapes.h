#ifndef SHAPES_H
#define SHAPES_H

#include <stddef.h>

// Shape types
typedef enum {
    SHAPE_RECTANGLE,
    SHAPE_CIRCLE,
    SHAPE_TRIANGLE
} ShapeType;

// Base shape structure
typedef struct {
    ShapeType type;
    double (*area)(void*);
    char* (*name)(void*);
} Shape;

// Rectangle
typedef struct {
    Shape base;
    double width;
    double height;
} Rectangle;

Rectangle* rectangle_create(double width, double height);
void rectangle_destroy(Rectangle* rect);

// Circle
typedef struct {
    Shape base;
    double radius;
} Circle;

Circle* circle_create(double radius);
void circle_destroy(Circle* circle);

// Triangle
typedef struct {
    Shape base;
    double base_length;
    double height;
} Triangle;

Triangle* triangle_create(double base_length, double height);
void triangle_destroy(Triangle* triangle);

// Utility functions
double calculate_total_area(void** shapes, size_t count);
void sort_by_area(void** shapes, size_t count);

#endif // SHAPES_H
