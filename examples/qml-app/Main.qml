import QtQuick 2.15
import QtQml 2.15
import QtQuick.Controls 2.15
import "./components"

Item {
  id: root
  width: 960
  height: 640

  property int counter: 0
  property string assetUrl: "./assets/logo.txt"

  // Background
  Rectangle {
    id: background
    anchors.fill: root
    color: "#f2f4f8"
    source: "./assets/logo.txt"
  }

  // ── Animated toggle button ────────────────────────────────────────────────
  Rectangle {
    id: button
    x: 40
    y: 40
    width: 220
    height: 72
    radius: 12
    color: "#4a90e2"
    borderColor: "#2d6dbf"
    borderWidth: 2

    // Animate color smoothly when state changes
    Behavior on color {
      ColorAnimation { duration: 200 }
    }

    MouseArea {
      anchors.fill: button
      onClicked: {
        counter = counter + 1;
        root.state = root.state === "active" ? "" : "active";
        console.log('Toggle state to:', root.state, 'counter:', counter);
      }
    }
  }

  // ── Animated panel ────────────────────────────────────────────────────────
  Rectangle {
    id: animPanel
    x: 300
    y: 40
    width: 200
    height: 72
    radius: 10
    color: "#ffffff"
    borderColor: "#c5d0e6"
    borderWidth: 1
  }

  // ── Floating ball (x-animated by Behavior) ─────────────────────────────
  Rectangle {
    id: ball
    y: 200
    x: 40
    width: 60
    height: 60
    radius: 30
    color: "#7b61ff"

    Behavior on x {
      NumberAnimation { duration: 400; easing: "OutQuad" }
    }

    Behavior on color {
      ColorAnimation { duration: 300 }
    }

    MouseArea {
      anchors.fill: ball
      onClicked: {
        ball.x = ball.x < 400 ? 600 : 40;
      }
    }
  }

  // ── Loader demo ───────────────────────────────────────────────────────────
  Loader {
    id: badgeLoader
    x: 580
    y: 40
    sourceComponent: Component {
      Rectangle {
        width: 180
        height: 72
        radius: 12
        color: "#fff6d6"
        borderColor: "#f0c36b"
        borderWidth: 1
      }
    }
  }

  // ── Status panel ─────────────────────────────────────────────────────────
  StatusPanel {
    id: statusPanel
    x: 40
    y: 150
    width: 380
    height: 180
    count: counter
    logoSource: "./assets/logo.txt"
  }

  // ── States / transitions ──────────────────────────────────────────────────
  states: [
    State {
      name: "active"
      PropertyChanges { target: button; color: "#27ae60"; borderColor: "#1a7a43" }
      PropertyChanges { target: animPanel; color: "#eafaf1"; borderColor: "#27ae60" }
    }
  ]

  transitions: [
    Transition {
      from: "*"
      to: "*"
      NumberAnimation { duration: 250; easing: "InOutQuad" }
    }
  ]
}
