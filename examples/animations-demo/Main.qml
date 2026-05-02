import QtQuick 2.15

// Animations demo: NumberAnimation / PropertyAnimation + Behavior
// Click the boxes to see Behavior-driven animations in action.
Item {
  id: root
  width: 800
  height: 500

  // ── Background ─────────────────────────────────────────────────────────────
  Rectangle {
    anchors.fill: root
    color: "#1a1a2e"
  }

  // ── Section: Behavior on x (click to toggle position) ─────────────────────
  Rectangle {
    id: moverBox
    y: 60
    x: 40
    width: 110
    height: 110
    radius: 12
    color: "#4a79ff"
    borderColor: "#2d55cc"
    borderWidth: 2

    Behavior on x {
      NumberAnimation { duration: 600; easing: "OutCubic" }
    }

    MouseArea {
      anchors.fill: moverBox
      onClicked: {
        moverBox.x = moverBox.x < 300 ? 580 : 40;
      }
    }
  }

  // ── Section: Behavior on opacity (hover effect) ────────────────────────────
  Rectangle {
    id: opacityBox
    x: 40
    y: 220
    width: 110
    height: 110
    radius: 12
    color: "#e74c3c"
    borderColor: "#c0392b"
    borderWidth: 2
    opacity: 1

    Behavior on opacity {
      NumberAnimation { duration: 300; easing: "InOutQuad" }
    }

    MouseArea {
      anchors.fill: opacityBox
      hoverEnabled: true
      onEntered: { opacityBox.opacity = 0.35; }
      onExited:  { opacityBox.opacity = 1.0; }
    }
  }

  // ── Section: PropertyAnimation on width (expand / collapse) ───────────────
  Rectangle {
    id: growBar
    x: 200
    y: 240
    width: 80
    height: 40
    radius: 8
    color: "#27ae60"
    borderColor: "#1e8449"
    borderWidth: 2

    Behavior on width {
      PropertyAnimation { duration: 500; easing: "OutQuad" }
    }

    MouseArea {
      anchors.fill: growBar
      onClicked: {
        growBar.width = growBar.width < 300 ? 400 : 80;
      }
    }
  }

  // ── Section: Behavior on color ─────────────────────────────────────────────
  Rectangle {
    id: colorBox
    x: 660
    y: 60
    width: 110
    height: 110
    radius: 12
    color: "#9b59b6"
    borderColor: "#7d3c98"
    borderWidth: 2

    Behavior on color {
      ColorAnimation { duration: 400 }
    }

    MouseArea {
      anchors.fill: colorBox
      onClicked: {
        colorBox.color = colorBox.color === "#9b59b6" ? "#f39c12" : "#9b59b6";
      }
    }
  }

  // ── Section: loops + NumberAnimation (bouncing y) ─────────────────────────
  Rectangle {
    id: bouncer
    x: 660
    y: 220
    width: 60
    height: 60
    radius: 30
    color: "#1abc9c"
    borderColor: "#17a589"
    borderWidth: 2

    NumberAnimation on y {
      from: 220
      to: 380
      duration: 400
      loops: -1
      easing: "InOutSine"
      running: true
    }
  }
}
