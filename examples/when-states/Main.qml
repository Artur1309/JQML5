import QtQuick 2.15

// Classic Qt Quick pattern: states driven by `when` conditions
// (hover / pressed / default) with animated transitions.
//
// Derived from the Qt documentation example on States and Transitions:
// https://doc.qt.io/qt-6/qmlstatesandtransitions.html
Item {
  id: root
  width: 640
  height: 400

  // ── Background ────────────────────────────────────────────────────────────
  Rectangle {
    anchors.fill: root
    color: "#1e1e2e"
  }

  // ── Interactive button whose look is fully driven by when-states ──────────
  Rectangle {
    id: btn
    x: 220
    y: 150
    width: 200
    height: 60
    radius: 10
    color: "#4a90e2"
    borderColor: "#2d6dbf"
    borderWidth: 2

    // Hover and press tracking -----------------------------------------------
    property bool hovered: hoverHandler.hovered
    property bool pressed: false

    HoverHandler {
      id: hoverHandler
    }

    MouseArea {
      anchors.fill: btn
      onPressed: { btn.pressed = true; }
      onReleased: { btn.pressed = false; }
      onClicked: { console.log("Button clicked!"); }
    }

    // States -----------------------------------------------------------------
    // `hovered` state is listed first; `pressed` is listed second so that
    // when both conditions are true simultaneously the `pressed` appearance
    // wins (later entry in the list takes priority per Qt rules).
    states: [
      State {
        name: "hovered"
        when: btn.hovered && !btn.pressed
        PropertyChanges { target: btn; color: "#6aaff0"; borderColor: "#4a90e2" }
      },
      State {
        name: "pressed"
        when: btn.pressed
        PropertyChanges { target: btn; color: "#2d6dbf"; borderColor: "#1a4a8f" }
      }
    ]

    transitions: [
      Transition {
        from: ""
        to: "hovered"
        ColorAnimation { duration: 120 }
      },
      Transition {
        from: "hovered"
        to: ""
        ColorAnimation { duration: 200 }
      },
      Transition {
        from: "*"
        to: "pressed"
        ColorAnimation { duration: 80 }
      },
      Transition {
        from: "pressed"
        to: "*"
        ColorAnimation { duration: 150 }
      }
    ]
  }

  // ── Animated indicator rectangle ──────────────────────────────────────────
  //
  // Another classic pattern: a panel whose position is driven by a when-state
  // that depends on an external boolean property.
  property bool panelOpen: false

  Rectangle {
    id: indicator
    x: 40
    y: 40
    width: 80
    height: 80
    radius: 12
    color: "#e74c3c"
    borderColor: "#c0392b"
    borderWidth: 2

    MouseArea {
      anchors.fill: indicator
      onClicked: { root.panelOpen = !root.panelOpen; }
    }

    states: [
      State {
        name: "open"
        when: root.panelOpen
        PropertyChanges { target: indicator; x: 500; color: "#2ecc71"; borderColor: "#27ae60" }
      }
    ]

    transitions: [
      Transition {
        from: "*"
        to: "open"
        NumberAnimation { property: "x"; duration: 400; easing: "OutCubic" }
        ColorAnimation { duration: 400 }
      },
      Transition {
        from: "open"
        to: ""
        NumberAnimation { property: "x"; duration: 300; easing: "InOutQuad" }
        ColorAnimation { duration: 300 }
      }
    ]
  }
}
