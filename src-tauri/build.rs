fn main() {
  tauri_build::build();

  // Compile Swift module on macOS
  #[cfg(target_os = "macos")]
  compile_swift_module();
}

#[cfg(target_os = "macos")]
fn compile_swift_module() {
    use std::process::Command;
    use std::env;

    println!("cargo:rerun-if-changed=ScreenRecorder/ScreenRecorder.swift");
    println!("cargo:rerun-if-changed=ScreenRecorder/ScreenRecorder.h");

    let out_dir = env::var("OUT_DIR").unwrap();
    let target = env::var("TARGET").unwrap();

    // Determine architecture
    let arch = if target.contains("aarch64") || target.contains("arm64") {
        "arm64"
    } else {
        "x86_64"
    };

    println!("cargo:warning=Compiling Swift ScreenRecorder module for {}", arch);

    // Compile Swift to dynamic library
    let output = Command::new("swiftc")
        .args(&[
            "-emit-library",
            "-emit-objc-header",
            "-emit-module",
            "-module-name", "ScreenRecorder",
            "-o", &format!("{}/libScreenRecorder.dylib", out_dir),
            "-emit-objc-header-path", &format!("{}/ScreenRecorder-Swift.h", out_dir),
            "ScreenRecorder/ScreenRecorder.swift",
            "-target", &format!("{}-apple-macosx12.3", arch),
            "-O", // Optimization
        ])
        .output()
        .expect("Failed to execute swiftc. Make sure Xcode Command Line Tools are installed.");

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        panic!("Swift compilation failed:\n{}", stderr);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    if !stdout.is_empty() {
        println!("cargo:warning=Swift compile output: {}", stdout);
    }

    println!("cargo:warning=Swift module compiled successfully");

    // Link against the Swift library
    println!("cargo:rustc-link-search=native={}", out_dir);
    println!("cargo:rustc-link-lib=dylib=ScreenRecorder");

    // Link against required system frameworks
    println!("cargo:rustc-link-lib=framework=ScreenCaptureKit");
    println!("cargo:rustc-link-lib=framework=AVFoundation");
    println!("cargo:rustc-link-lib=framework=CoreMedia");
    println!("cargo:rustc-link-lib=framework=CoreGraphics");
    println!("cargo:rustc-link-lib=framework=CoreVideo");
    println!("cargo:rustc-link-lib=framework=Foundation");
}
