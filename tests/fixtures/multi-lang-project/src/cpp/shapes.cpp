#include "shapes.h"
#include <iostream>
#include <algorithm>
#include <cmath>

namespace shapes {

// Shape base class method
void Shape::print() const {
    std::cout << name() << " area: " << area() << std::endl;
}

// Rectangle implementation
Rectangle::Rectangle(double w, double h) : width_(w), height_(h) {}

double Rectangle::area() const {
    return width_ * height_;
}

std::string Rectangle::name() const {
    return "Rectangle";
}

// Circle implementation
Circle::Circle(double r) : radius_(r) {}

double Circle::area() const {
    return M_PI * radius_ * radius_;
}

std::string Circle::name() const {
    return "Circle";
}

// Utility: Calculate total area
double calculateTotalArea(const std::vector<Shape*>& shapes) {
    double total = 0.0;
    for (const auto* shape : shapes) {
        total += shape->area();
    }
    return total;
}

// Utility: Sort shapes by area
void sortByArea(std::vector<Shape*>& shapes) {
    std::sort(shapes.begin(), shapes.end(), [](Shape* a, Shape* b) {
        return a->area() < b->area();
    });
}

} // namespace shapes
