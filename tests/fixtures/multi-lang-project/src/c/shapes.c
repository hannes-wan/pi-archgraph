#include "shapes.h"
#include <stdlib.h>
#include <string.h>
#include <math.h>

// Rectangle implementation
static double rectangle_area_impl(void* self) {
    Rectangle* rect = (Rectangle*)self;
    return rect->width * rect->height;
}

static char* rectangle_name_impl(void* self) {
    return "Rectangle";
}

Rectangle* rectangle_create(double width, double height) {
    Rectangle* rect = (Rectangle*)malloc(sizeof(Rectangle));
    if (!rect) return NULL;
    
    rect->base.type = SHAPE_RECTANGLE;
    rect->base.area = rectangle_area_impl;
    rect->base.name = rectangle_name_impl;
    rect->width = width;
    rect->height = height;
    
    return rect;
}

void rectangle_destroy(Rectangle* rect) {
    free(rect);
}

// Circle implementation
static double circle_area_impl(void* self) {
    Circle* circle = (Circle*)self;
    return M_PI * circle->radius * circle->radius;
}

static char* circle_name_impl(void* self) {
    return "Circle";
}

Circle* circle_create(double radius) {
    Circle* circle = (Circle*)malloc(sizeof(Circle));
    if (!circle) return NULL;
    
    circle->base.type = SHAPE_CIRCLE;
    circle->base.area = circle_area_impl;
    circle->base.name = circle_name_impl;
    circle->radius = radius;
    
    return circle;
}

void circle_destroy(Circle* circle) {
    free(circle);
}

// Triangle implementation
static double triangle_area_impl(void* self) {
    Triangle* tri = (Triangle*)self;
    return 0.5 * tri->base_length * tri->height;
}

static char* triangle_name_impl(void* self) {
    return "Triangle";
}

Triangle* triangle_create(double base_length, double height) {
    Triangle* tri = (Triangle*)malloc(sizeof(Triangle));
    if (!tri) return NULL;
    
    tri->base.type = SHAPE_TRIANGLE;
    tri->base.area = triangle_area_impl;
    tri->base.name = triangle_name_impl;
    tri->base_length = base_length;
    tri->height = height;
    
    return tri;
}

void triangle_destroy(Triangle* tri) {
    free(tri);
}

// Utility: Calculate total area
double calculate_total_area(void** shapes, size_t count) {
    double total = 0.0;
    for (size_t i = 0; i < count; i++) {
        Shape* shape = (Shape*)shapes[i];
        total += shape->area(shapes[i]);
    }
    return total;
}

// Utility: Sort shapes by area (bubble sort for simplicity)
void sort_by_area(void** shapes, size_t count) {
    for (size_t i = 0; i < count - 1; i++) {
        for (size_t j = 0; j < count - i - 1; j++) {
            Shape* a = (Shape*)shapes[j];
            Shape* b = (Shape*)shapes[j + 1];
            
            if (a->area(shapes[j]) > b->area(shapes[j + 1])) {
                void* temp = shapes[j];
                shapes[j] = shapes[j + 1];
                shapes[j + 1] = temp;
            }
        }
    }
}
