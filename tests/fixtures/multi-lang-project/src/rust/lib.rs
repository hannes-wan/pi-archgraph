mod shapes;

use shapes::{Circle, Rectangle, Triangle, Shape, calculate_total_area};

pub use shapes::Shape;

fn main() {
    println!("Rust Architecture Graph Test");
    
    let shapes: Vec<Box<dyn Shape>> = vec![
        Box::new(Rectangle::new(5.0, 3.0)),
        Box::new(Circle::new(2.0)),
        Box::new(Triangle::new(6.0, 4.0)),
    ];
    
    let areas: Vec<f64> = shapes.iter().map(|s| s.area()).collect();
    println!("Total area: {}", calculate_total_area(&areas.as_slice()));
    
    for shape in &shapes {
        println!("{}: {:.2}", shape.name(), shape.area());
    }
}
