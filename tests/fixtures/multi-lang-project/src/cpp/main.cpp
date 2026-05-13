#include "shapes.h"
#include <iostream>
#include <memory>

int main() {
    std::cout << "Multi-language Architecture Graph Test" << std::endl;
    
    std::vector<shapes::Shape*> shapes;
    
    shapes.push_back(new shapes::Rectangle(5.0, 3.0));
    shapes.push_back(new shapes::Circle(2.0));
    shapes.push_back(new shapes::Rectangle(10.0, 2.0));
    
    std::cout << "Total area: " << shapes::calculateTotalArea(shapes) << std::endl;
    
    shapes::sortByArea(shapes);
    
    for (const auto* shape : shapes) {
        shape->print();
    }
    
    for (auto* shape : shapes) {
        delete shape;
    }
    
    return 0;
}
