#include "shapes.h"
#include <stdio.h>

int main() {
    printf("C Architecture Graph Test\n");
    
    Rectangle* rect = rectangle_create(5.0, 3.0);
    Circle* circle = circle_create(2.0);
    Triangle* triangle = triangle_create(6.0, 4.0);
    
    void* shapes[] = { rect, circle, triangle };
    size_t count = sizeof(shapes) / sizeof(shapes[0]);
    
    printf("Total area: %.2f\n", calculate_total_area(shapes, count));
    
    sort_by_area(shapes, count);
    
    for (size_t i = 0; i < count; i++) {
        Shape* shape = (Shape*)shapes[i];
        printf("%s: %.2f\n", shape->name(shapes[i]), shape->area(shapes[i]));
    }
    
    rectangle_destroy(rect);
    circle_destroy(circle);
    triangle_destroy(triangle);
    
    return 0;
}
