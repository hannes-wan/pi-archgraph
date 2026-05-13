"""Shape classes for testing architecture graph."""
import math
from abc import ABC, abstractmethod
from typing import List


class Shape(ABC):
    """Base class for all shapes."""
    
    @abstractmethod
    def area(self) -> float:
        """Calculate the area of the shape."""
        pass
    
    @abstractmethod
    def name(self) -> str:
        """Return the name of the shape."""
        pass


class Rectangle(Shape):
    """Rectangle shape implementation."""
    
    def __init__(self, width: float, height: float):
        self.width = width
        self.height = height
    
    def area(self) -> float:
        return self.width * self.height
    
    def name(self) -> str:
        return "Rectangle"
    
    def get_width(self) -> float:
        return self.width
    
    def get_height(self) -> float:
        return self.height


class Circle(Shape):
    """Circle shape implementation."""
    
    def __init__(self, radius: float):
        self.radius = radius
    
    def area(self) -> float:
        return math.pi * self.radius ** 2
    
    def name(self) -> str:
        return "Circle"
    
    def get_radius(self) -> float:
        return self.radius


class Triangle(Shape):
    """Triangle shape implementation."""
    
    def __init__(self, base: float, height: float):
        self.base = base
        self.height = height
    
    def area(self) -> float:
        return 0.5 * self.base * self.height
    
    def name(self) -> str:
        return "Triangle"


def calculate_total_area(shapes: List[Shape]) -> float:
    """Calculate total area of all shapes."""
    return sum(shape.area() for shape in shapes)


def sort_by_area(shapes: List[Shape]) -> List[Shape]:
    """Sort shapes by area in ascending order."""
    return sorted(shapes, key=lambda s: s.area())
