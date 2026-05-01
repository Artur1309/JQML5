import QtQuick 2.15
import QtQuick.Controls 2.15

// PR-B Controls Demo
// Demonstrates: ComboBox, SpinBox, TextArea, ToolTip, Drawer,
//               Menu keyboard navigation, and Popup close policies.

Item {
  id: root
  width: 900
  height: 660

  // ── Background ─────────────────────────────────────────────────────────────
  Rectangle {
    anchors.fill: root
    color: "#f0f2f5"
  }

  // ── Title ──────────────────────────────────────────────────────────────────
  Label {
    x: 24; y: 16
    text: "PR-B: QtQuick.Controls Parity Demo"
    color: "#1a1a2e"
    font.pixelSize: 20
    font.bold: true
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Left column – ComboBox, SpinBox, TextArea
  // ═══════════════════════════════════════════════════════════════════════════

  // ── ComboBox ───────────────────────────────────────────────────────────────
  Label {
    x: 24; y: 58
    text: "ComboBox:"
    color: "#444466"
  }

  ComboBox {
    id: colorCombo
    x: 24; y: 80
    width: 200; height: 36
    model: ["Red", "Green", "Blue", "Yellow", "Cyan", "Magenta"]
    currentIndex: 0
    onActivated: {
      comboStatus.text = "Selected: " + colorCombo.currentText + " (index " + colorCombo.currentIndex + ")"
    }
  }

  Label {
    id: comboStatus
    x: 24; y: 124
    text: "Select a colour above"
    color: "#555577"
  }

  // ── SpinBox ────────────────────────────────────────────────────────────────
  Label {
    x: 24; y: 160
    text: "SpinBox (from 0 to 20, step 1):"
    color: "#444466"
  }

  SpinBox {
    id: mySpinBox
    x: 24; y: 182
    width: 160; height: 36
    from: 0
    to: 20
    value: 5
    stepSize: 1
    onValueChanged: {
      spinStatus.text = "SpinBox value: " + mySpinBox.value
    }
  }

  Label {
    id: spinStatus
    x: 24; y: 226
    text: "SpinBox value: 5"
    color: "#555577"
  }

  // ── TextArea ───────────────────────────────────────────────────────────────
  Label {
    x: 24; y: 262
    text: "TextArea (multi-line):"
    color: "#444466"
  }

  TextArea {
    id: myTextArea
    x: 24; y: 284
    width: 360; height: 100
    placeholderText: "Type multiple lines here…"
    wrapMode: TextArea.WordWrap
  }

  Label {
    x: 24; y: 394
    text: "TextArea (read-only):"
    color: "#444466"
  }

  TextArea {
    x: 24; y: 416
    width: 360; height: 60
    text: "This text cannot be edited.\nIt is read-only."
    readOnly: true
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Right column – Popup, Menu, ToolTip, Drawer
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Popup close policies ───────────────────────────────────────────────────
  Label {
    x: 460; y: 58
    text: "Popup close policies:"
    color: "#444466"
  }

  Button {
    id: pressOutsideBtn
    x: 460; y: 80
    width: 200; height: 36
    text: "CloseOnPressOutside"
    onClicked: {
      pressPopup.open()
    }
  }

  Button {
    id: releaseOutsideBtn
    x: 460; y: 124
    width: 200; height: 36
    text: "CloseOnReleaseOutside"
    onClicked: {
      releasePopup.open()
    }
  }

  Button {
    id: noAutoCloseBtn
    x: 460; y: 168
    width: 200; height: 36
    text: "NoAutoClose (Escape only)"
    onClicked: {
      noClosePopup.open()
    }
  }

  // ── Menu with keyboard navigation ──────────────────────────────────────────
  Label {
    x: 460; y: 220
    text: "Menu (use Up/Down/Enter to navigate):"
    color: "#444466"
  }

  Button {
    id: menuBtn
    x: 460; y: 242
    width: 200; height: 36
    text: "Open Context Menu"
    onClicked: {
      contextMenu.x = menuBtn.x
      contextMenu.y = menuBtn.y + menuBtn.height
      contextMenu.open()
    }
  }

  Label {
    id: menuStatus
    x: 460; y: 286
    text: "(no item selected)"
    color: "#555577"
  }

  // ── ToolTip ────────────────────────────────────────────────────────────────
  Label {
    x: 460; y: 322
    text: "ToolTip:"
    color: "#444466"
  }

  Button {
    id: tooltipBtn
    x: 460; y: 344
    width: 200; height: 36
    text: "Show ToolTip"
    onClicked: {
      myToolTip.open()
    }
  }

  ToolTip {
    id: myToolTip
    x: tooltipBtn.x
    y: tooltipBtn.y - 36
    width: 200; height: 28
    text: "This is a ToolTip!"
    timeout: 2000
  }

  // ── Drawer ─────────────────────────────────────────────────────────────────
  Label {
    x: 460; y: 396
    text: "Drawer (slides from left edge):"
    color: "#444466"
  }

  Button {
    id: drawerBtn
    x: 460; y: 418
    width: 200; height: 36
    text: "Open Drawer"
    onClicked: {
      leftDrawer.open()
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Popups
  // ═══════════════════════════════════════════════════════════════════════════

  Popup {
    id: pressPopup
    x: 200; y: 200
    width: 260; height: 100
    closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside
    Label {
      x: 12; y: 16
      text: "CloseOnPressOutside popup\n(click outside to close)"
      color: "#333355"
    }
  }

  Popup {
    id: releasePopup
    x: 200; y: 200
    width: 260; height: 100
    closePolicy: Popup.CloseOnEscape | Popup.CloseOnReleaseOutside
    Label {
      x: 12; y: 16
      text: "CloseOnReleaseOutside popup\n(release outside to close)"
      color: "#333355"
    }
  }

  Popup {
    id: noClosePopup
    x: 200; y: 200
    width: 260; height: 100
    closePolicy: Popup.CloseOnEscape
    Label {
      x: 12; y: 16
      text: "NoAutoClose popup\n(press Escape to close)"
      color: "#333355"
    }
  }

  // ── Context Menu ───────────────────────────────────────────────────────────
  Menu {
    id: contextMenu
    width: 200
    closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside

    MenuItem {
      text: "Cut"
      onTriggered: { menuStatus.text = "Cut selected" }
    }
    MenuItem {
      text: "Copy"
      onTriggered: { menuStatus.text = "Copy selected" }
    }
    MenuItem {
      text: "Paste"
      onTriggered: { menuStatus.text = "Paste selected" }
    }
    MenuItem {
      text: "Delete"
      enabled: false
      onTriggered: { menuStatus.text = "Delete selected" }
    }
  }

  // ── Drawer ─────────────────────────────────────────────────────────────────
  Drawer {
    id: leftDrawer
    edge: Qt.LeftEdge
    width: 220
    modal: true
    dim: true

    Label {
      x: 20; y: 20
      text: "Left Drawer"
      color: "#1a1a2e"
      font.pixelSize: 16
      font.bold: true
    }

    Label {
      x: 20; y: 56
      text: "Slide-in panel from the\nleft edge of the screen.\n\nClick outside to close."
      color: "#444466"
    }

    Button {
      x: 20; y: 160
      width: 160; height: 36
      text: "Close Drawer"
      onClicked: { leftDrawer.close() }
    }
  }
}
