"""Main entry point for Python shapes demo."""
from shapes import Rectangle, Circle, Triangle, calculate_total_area, sort_by_area


def main():
    """Run the shapes demo."""
    print("Python Architecture Graph Test")
    
    shapes = [
        Rectangle(5.0, 3.0),
        Circle(2.0),
        Triangle(6.0, 4.0),
    ]
    
    print(f"Total area: {calculate_total_area(shapes):.2f}")
    
    sorted_shapes = sort_by_area(shapes)
    for shape in sorted_shapes:
        print(f"{shape.name()}: {shape.area():.2f}")


if __name__ == "__main__":
    main()
