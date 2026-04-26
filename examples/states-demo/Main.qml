import QtQuick 2.15

// Stage A demo: States / Transitions / Animations / Behavior
Item {
  id: root
  width: 800
  height: 500

  // ── Background ────────────────────────────────────────────────────────────
  Rectangle {
    anchors.fill: root
    color: "#1a1a2e"
  }

  // ── Title label ───────────────────────────────────────────────────────────
  Rectangle {
    x: 20
    y: 16
    width: 760
    height: 36
    color: "transparent"
  }

  // ── Animated rectangle – demonstrates Behavior on x / color ──────────────
  Rectangle {
    id: movingBox
    y: 80
    x: 40
    width: 120
    height: 120
    radius: 14
    color: "#4a79ff"
    borderColor: "#2d55cc"
    borderWidth: 2

    Behavior on x {
      NumberAnimation { duration: 500; easing: "OutCubic" }
    }

    Behavior on color {
      ColorAnimation { duration: 400 }
    }

    Behavior on y {
      NumberAnimation { duration: 500; easing: "InOutQuad" }
    }

    MouseArea {
      anchors.fill: movingBox
      onClicked: {
        movingBox.x = movingBox.x < 300 ? 560 : 40;
        movingBox.color = movingBox.color === "#4a79ff" ? "#e74c3c" : "#4a79ff";
      }
    }
  }

  // ── State-driven panel ────────────────────────────────────────────────────
  Rectangle {
    id: statePanel
    x: 220
    y: 80
    width: 260
    height: 120
    radius: 10
    color: "#16213e"
    borderColor: "#0f3460"
    borderWidth: 2
    opacity: 1
  }

  // ── Toggle button ─────────────────────────────────────────────────────────
  Rectangle {
    id: toggleBtn
    x: 220
    y: 240
    width: 180
    height: 52
    radius: 10
    color: "#0f3460"
    borderColor: "#533483"
    borderWidth: 2

    Behavior on color {
      ColorAnimation { duration: 200 }
    }

    MouseArea {
      anchors.fill: toggleBtn
      onClicked: {
        root.state = root.state === "expanded" ? "" : "expanded";
      }
    }
  }

  // ── Number animation demo ──────────────────────────────────────────────────
  Rectangle {
    id: progressBar
    x: 40
    y: 260
    width: 0
    height: 24
    radius: 4
    color: "#27ae60"
  }

  Rectangle {
    id: progressTrack
    x: 40
    y: 260
    width: 160
    height: 24
    radius: 4
    color: "#0f3460"
    borderColor: "#16213e"
    borderWidth: 1
  }

  // ── Sequential animation trigger ──────────────────────────────────────────
  Rectangle {
    id: seqBtn
    x: 560
    y: 80
    width: 180
    height: 52
    radius: 10
    color: "#533483"
    borderColor: "#7b52ab"
    borderWidth: 2

    Behavior on color {
      ColorAnimation { duration: 150 }
    }

    MouseArea {
      anchors.fill: seqBtn
      onClicked: {
        seqBtn.color = "#7b52ab";
        movingBox.y = movingBox.y < 200 ? 280 : 80;
      }
    }
  }

  // ── States declaration ─────────────────────────────────────────────────────
  states: [
    State {
      name: "expanded"
      PropertyChanges { target: statePanel; color: "#533483"; borderColor: "#7b52ab" }
      PropertyChanges { target: toggleBtn; color: "#7b52ab" }
      PropertyChanges { target: progressBar; width: 160 }
    }
  ]

  transitions: [
    Transition {
      from: "*"
      to: "expanded"
      NumberAnimation { duration: 350; easing: "OutQuad" }
    },
    Transition {
      from: "expanded"
      to: ""
      NumberAnimation { duration: 300; easing: "InQuad" }
    }
  ]
}
