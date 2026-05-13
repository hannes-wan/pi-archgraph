#pragma once
#include <string>
#include <vector>

namespace shapes {

// Base class for all shapes
class Shape {
public:
    virtual ~Shape() = default;
    virtual double area() const = 0;
    virtual std::string name() const = 0;
    void print() const;
};

// Rectangle implementation
class Rectangle : public Shape {
private:
    double width_;
    double height_;
    
public:
    Rectangle(double w, double h);
    double area() const override;
    std::string name() const override;
    double getWidth() const { return width_; }
    double getHeight() const { return height_; }
};

// Circle implementation  
class Circle : public Shape {
private:
    double radius_;
    
public:
    explicit Circle(double r);
    double area() const override;
    std::string name() const override;
    double getRadius() const { return radius_; }
};

// Utility functions
double calculateTotalArea(const std::vector<Shape*>& shapes);
void sortByArea(std::vector<Shape*>& shapes);

} // namespace shapes
