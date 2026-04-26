import QtQuick 2.15

// Stage E demo: clip, transforms (rotation/scale), Image, Text caching
Item {
  id: root
  width: 800
  height: 600

  property real angle: 0

  // Background
  Rectangle {
    anchors.fill: root
    color: "#1a1a2e"
  }

  // ── Section 1: Clipped container with rotating child ──────────────────────
  Rectangle {
    id: clipSection
    x: 40
    y: 40
    width: 200
    height: 140
    color: "#16213e"
    radius: 8
    clip: true

    Text {
      x: 8; y: 8
      text: "clip: true"
      color: "#a0a0c0"
      font.pixelSize: 11
    }

    // Rotating rectangle that extends beyond the clip boundary
    Rectangle {
      x: 60; y: 30
      width: 120
      height: 120
      color: "#e94560"
      radius: 6
      rotation: root.angle
      transformOrigin: "Center"
      opacity: 0.85
    }
  }

  // ── Section 2: Scale transform demo ───────────────────────────────────────
  Rectangle {
    id: scaleSection
    x: 280
    y: 40
    width: 200
    height: 140
    color: "#16213e"
    radius: 8

    Text {
      x: 8; y: 8
      text: "scale"
      color: "#a0a0c0"
      font.pixelSize: 11
    }

    Rectangle {
      x: 75; y: 50
      width: 50
      height: 50
      color: "#0f3460"
      radius: 4
      scale: 1.5
      transformOrigin: "Center"

      Rectangle {
        x: 10; y: 10
        width: 30
        height: 30
        color: "#e94560"
        radius: 2
      }
    }
  }

  // ── Section 3: Combined rotation + scale ──────────────────────────────────
  Rectangle {
    id: rotscaleSection
    x: 520
    y: 40
    width: 200
    height: 140
    color: "#16213e"
    radius: 8

    Text {
      x: 8; y: 8
      text: "rotation + scale"
      color: "#a0a0c0"
      font.pixelSize: 11
    }

    Rectangle {
      x: 75; y: 45
      width: 60
      height: 60
      color: "#533483"
      radius: 4
      rotation: root.angle * 1.5
      scale: 1.2
      transformOrigin: "Center"

      Text {
        x: 5; y: 5
        text: "QML"
        color: "#ffffff"
        font.pixelSize: 14
      }
    }
  }

  // ── Section 4: Image loading ───────────────────────────────────────────────
  Rectangle {
    id: imageSection
    x: 40
    y: 220
    width: 340
    height: 160
    color: "#16213e"
    radius: 8

    Text {
      x: 8; y: 8
      text: "Image (async loading)"
      color: "#a0a0c0"
      font.pixelSize: 11
    }

    Image {
      id: img1
      x: 20; y: 30
      width: 120; height: 100
      source: "assets/demo.png"
      fillMode: "PreserveAspectFit"
    }

    Rectangle {
      x: 20; y: 30
      width: 120; height: 100
      color: "transparent"
      border.color: "#e94560"
      border.width: 1
      radius: 4
    }

    Text {
      x: 155; y: 50
      width: 160
      text: "Status: " + (img1.status === 0 ? "Null"
              : img1.status === 1 ? "Loading"
              : img1.status === 2 ? "Ready"
              : "Error")
      color: "#c0c0e0"
      font.pixelSize: 12
    }

    Text {
      x: 155; y: 75
      width: 160
      text: "fillMode: PreserveAspectFit"
      color: "#a0a0c0"
      font.pixelSize: 11
    }
  }

  // ── Section 5: Text stress test + caching ─────────────────────────────────
  Rectangle {
    id: textSection
    x: 420
    y: 220
    width: 320
    height: 160
    color: "#16213e"
    radius: 8
    clip: true

    Text {
      x: 8; y: 8
      text: "Text caching (many labels)"
      color: "#a0a0c0"
      font.pixelSize: 11
    }

    Text { x: 12; y: 30;  text: "The quick brown fox jumps";  color: "#e0e0ff"; font.pixelSize: 12 }
    Text { x: 12; y: 47;  text: "over the lazy dog";          color: "#c0c0e0"; font.pixelSize: 11 }
    Text { x: 12; y: 62;  text: "Pack my box with five";      color: "#a0a0c0"; font.pixelSize: 10 }
    Text { x: 12; y: 75;  text: "dozen liquor jugs";          color: "#808080"; font.pixelSize: 10 }
    Text { x: 12; y: 88;  text: "Sphinx of black quartz";     color: "#e0e0ff"; font.pixelSize: 12 }
    Text { x: 12; y: 103; text: "judge my vow";               color: "#c0c0e0"; font.pixelSize: 11 }
    Text { x: 12; y: 116; text: "How vexingly quick";         color: "#a0a0c0"; font.pixelSize: 10 }
    Text { x: 12; y: 129; text: "daft zebras jump!";          color: "#808080"; font.pixelSize: 10 }
  }

  // ── Section 6: Layer.enabled demo ─────────────────────────────────────────
  Rectangle {
    id: layerSection
    x: 40
    y: 420
    width: 340
    height: 140
    color: "#16213e"
    radius: 8

    Text {
      x: 8; y: 8
      text: "layer.enabled"
      color: "#a0a0c0"
      font.pixelSize: 11
    }

    Rectangle {
      x: 20; y: 35
      width: 120
      height: 80
      color: "#0f3460"
      radius: 6
      layer.enabled: true
      rotation: root.angle * 0.5

      Rectangle {
        x: 10; y: 10
        width: 40; height: 40
        color: "#e94560"
        radius: 4
        rotation: root.angle
      }

      Text {
        x: 55; y: 30
        text: "layer"
        color: "#ffffff"
        font.pixelSize: 12
      }
    }

    Text {
      x: 160; y: 45
      width: 160
      text: "Subtree cached to\noffscreen canvas."
      color: "#c0c0e0"
      font.pixelSize: 11
    }
  }

  // ── Animation driver ──────────────────────────────────────────────────────
  NumberAnimation {
    target: root
    property: "angle"
    from: 0
    to: 360
    duration: 4000
    loops: -1
    running: true
  }
}
