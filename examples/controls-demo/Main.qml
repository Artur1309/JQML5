import QtQuick 2.15
import QtQuick.Controls 2.15

// Stage D demo: Button, Label, TextField, Slider, CheckBox
Item {
  id: root
  width: 700
  height: 500

  property int clickCount: 0
  property real sliderVal: 0.5
  property string inputText: ""
  property bool optionChecked: false

  // ── Background ──────────────────────────────────────────────────────────────
  Rectangle {
    anchors.fill: root
    color: "#f2f4f8"
  }

  // ── Title ───────────────────────────────────────────────────────────────────
  Label {
    x: 40
    y: 24
    text: "JQML5 Controls Demo – Stage D"
    color: "#1a1a2e"
    font.pixelSize: 20
    font.bold: true
  }

  // ── Button section ──────────────────────────────────────────────────────────
  Label {
    x: 40
    y: 80
    text: "Button (Tab / Enter / Space to activate):"
    color: "#444466"
  }

  Button {
    id: mainBtn
    x: 40
    y: 108
    width: 160
    height: 40
    text: "Click me"
    onClicked: {
      root.clickCount = root.clickCount + 1
    }
  }

  Button {
    x: 220
    y: 108
    width: 120
    height: 40
    text: "Disabled"
    enabled: false
  }

  Label {
    x: 40
    y: 162
    text: root.clickCount + " clicks so far"
    color: "#4a79ff"
  }

  // ── TextField section ───────────────────────────────────────────────────────
  Label {
    x: 40
    y: 200
    text: "TextField (click to focus, then type):"
    color: "#444466"
  }

  TextField {
    id: myField
    x: 40
    y: 228
    width: 280
    height: 36
    placeholderText: "Type something here..."
    onTextChanged: {
      root.inputText = text
    }
  }

  Label {
    x: 340
    y: 228
    text: myField.text !== "" ? myField.text : "(empty)"
    color: myField.text !== "" ? "#1a1a2e" : "#aaaaaa"
  }

  // ── Slider section ──────────────────────────────────────────────────────────
  Label {
    x: 40
    y: 284
    text: "Slider (drag or arrow keys):"
    color: "#444466"
  }

  Slider {
    id: mySlider
    x: 40
    y: 312
    width: 300
    height: 28
    from: 0
    to: 1
    value: 0.5
    stepSize: 0.05
    onValueChanged: {
      root.sliderVal = value
    }
  }

  Label {
    x: 360
    y: 316
    text: Math.round(root.sliderVal * 100) / 100
    color: "#1a1a2e"
  }

  // ── CheckBox section ────────────────────────────────────────────────────────
  Label {
    x: 40
    y: 364
    text: "CheckBox (click or Space/Enter to toggle):"
    color: "#444466"
  }

  CheckBox {
    id: checkA
    x: 40
    y: 392
    width: 180
    height: 28
    text: "Enable feature A"
    checked: false
    onClicked: {
      root.optionChecked = checkA.checked
    }
  }

  CheckBox {
    x: 240
    y: 392
    width: 180
    height: 28
    text: "Pre-checked option"
    checked: true
  }

  Label {
    x: 40
    y: 436
    text: checkA.checked ? "Feature A: ON" : "Feature A: OFF"
    color: checkA.checked ? "#27ae60" : "#e74c3c"
  }
}
