use std::f64::consts::PI;

/// Base trait for all shapes
pub trait Shape {
    fn area(&self) -> f64;
    fn name(&self) -> &str;
}

/// Rectangle struct
pub struct Rectangle {
    width: f64,
    height: f64,
}

impl Rectangle {
    pub fn new(width: f64, height: f64) -> Self {
        Rectangle { width, height }
    }
    
    pub fn get_width(&self) -> f64 {
        self.width
    }
    
    pub fn get_height(&self) -> f64 {
        self.height
    }
}

impl Shape for Rectangle {
    fn area(&self) -> f64 {
        self.width * self.height
    }
    
    fn name(&self) -> &str {
        "Rectangle"
    }
}

/// Circle struct
pub struct Circle {
    radius: f64,
}

impl Circle {
    pub fn new(radius: f64) -> Self {
        Circle { radius }
    }
    
    pub fn get_radius(&self) -> f64 {
        self.radius
    }
}

impl Shape for Circle {
    fn area(&self) -> f64 {
        PI * self.radius * self.radius
    }
    
    fn name(&self) -> &str {
        "Circle"
    }
}

/// Triangle struct
pub struct Triangle {
    base: f64,
    height: f64,
}

impl Triangle {
    pub fn new(base: f64, height: f64) -> Self {
        Triangle { base, height }
    }
}

impl Shape for Triangle {
    fn area(&self) -> f64 {
        0.5 * self.base * self.height
    }
    
    fn name(&self) -> &str {
        "Triangle"
    }
}

/// Calculate total area of shapes
pub fn calculate_total_area<T: Shape>(shapes: &[T]) -> f64 {
    shapes.iter().map(|s| s.area()).sum()
}

/// Sort shapes by area
pub fn sort_by_area<T: Shape>(shapes: &mut [T]) {
    shapes.sort_by(|a, b| a.area().partial_cmp(&b.area()).unwrap());
}
