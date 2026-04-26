import QtQuick 2.0
import QtQuick.Controls 2.0

// Layout demo – showcases Row, Column, and Flow positioners.
//
// Left panel  – Row with buttons and Column with mixed rectangles / text
// Right panel – Flow with wrapping on resize and an RTL toggle

Item {
    id: root
    width: 960
    height: 640

    // -----------------------------------------------------------------------
    // Header
    // -----------------------------------------------------------------------
    Rectangle {
        id: header
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        height: 48
        color: "#1a1a2e"

        Text {
            anchors.verticalCenter: parent.verticalCenter
            x: 16
            text: "Layout Demo  –  Row · Column · Flow"
            color: "#ffffff"
            font.pixelSize: 15
        }
    }

    // -----------------------------------------------------------------------
    // Left panel – Row + Column examples
    // -----------------------------------------------------------------------
    Rectangle {
        id: leftPanel
        anchors.top: header.bottom
        anchors.bottom: root.bottom
        anchors.left: root.left
        width: 480
        color: "#f5f5f5"

        // Section label
        Text {
            id: rowLabel
            x: 12; y: 12
            text: "Row  (spacing: 8, padding: 8)"
            font.pixelSize: 13
            color: "#333"
        }

        // Row of buttons
        Row {
            id: buttonRow
            anchors.top: rowLabel.bottom
            anchors.topMargin: 6
            x: 12
            spacing: 8
            padding: 8

            Button { text: "Button A"; width: 90; height: 32 }
            Button { text: "Button B"; width: 90; height: 32 }
            Button { text: "Button C"; width: 90; height: 32 }
            Button { text: "Off";      width: 60; height: 32; visible: false }
            Button { text: "Button D"; width: 90; height: 32 }
        }

        // Divider
        Rectangle {
            id: divider1
            anchors.top: buttonRow.bottom
            anchors.topMargin: 8
            x: 12
            width: parent.width - 24
            height: 1
            color: "#cccccc"
        }

        // Section label
        Text {
            id: colLabel
            anchors.top: divider1.bottom
            anchors.topMargin: 8
            x: 12
            text: "Column  (spacing: 6, padding: 8)"
            font.pixelSize: 13
            color: "#333"
        }

        // Column of mixed items
        Column {
            id: mixedColumn
            anchors.top: colLabel.bottom
            anchors.topMargin: 6
            x: 12
            spacing: 6
            padding: 8

            Rectangle {
                width: 200; height: 36; color: "#ff6b6b"; radius: 4
                Text { anchors.centerIn: parent; text: "Red rectangle"; color: "#fff"; font.pixelSize: 13 }
            }
            Text {
                text: "Plain text item"
                font.pixelSize: 14
                color: "#333"
            }
            Rectangle {
                width: 200; height: 36; color: "#4dabf7"; radius: 4
                Text { anchors.centerIn: parent; text: "Blue rectangle"; color: "#fff"; font.pixelSize: 13 }
            }
            Text {
                text: "Another text item"
                font.pixelSize: 14
                color: "#666"
            }
            Rectangle {
                width: 200; height: 36; color: "#69db7c"; radius: 4
                Text { anchors.centerIn: parent; text: "Green rectangle"; color: "#fff"; font.pixelSize: 13 }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Right panel – Flow example
    // -----------------------------------------------------------------------
    Rectangle {
        id: rightPanel
        anchors.top: header.bottom
        anchors.bottom: root.bottom
        anchors.left: leftPanel.right
        anchors.right: root.right
        color: "#e8eaf6"

        // Section label + RTL toggle
        Text {
            id: flowLabel
            x: 12; y: 12
            text: "Flow  (LeftToRight, spacing: 8, wraps at panel width)"
            font.pixelSize: 13
            color: "#333"
        }

        // RTL toggle button
        Rectangle {
            id: rtlBtn
            anchors.right: parent.right
            anchors.rightMargin: 12
            anchors.verticalCenter: flowLabel.verticalCenter
            width: 100; height: 28
            color: "#748ffc"; radius: 4
            Text { anchors.centerIn: parent; text: "Toggle RTL"; color: "#fff"; font.pixelSize: 12 }
            MouseArea {
                anchors.fill: parent
                onClicked: {
                    demoFlow.layoutDirection =
                        demoFlow.layoutDirection === "LeftToRight" ? "RightToLeft" : "LeftToRight"
                    flowLabel.text = "Flow  (" + demoFlow.layoutDirection + ", spacing: 8)"
                }
            }
        }

        // Flow of coloured tiles that wrap when the panel is narrow
        Flow {
            id: demoFlow
            anchors.top: flowLabel.bottom
            anchors.topMargin: 8
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.leftMargin: 12
            anchors.rightMargin: 12
            spacing: 8
            padding: 8
            layoutDirection: "LeftToRight"

            Rectangle { width: 80; height: 60; color: "#ff6b6b"; radius: 4; Text { anchors.centerIn: parent; text: "A"; color: "#fff"; font.pixelSize: 18 } }
            Rectangle { width: 80; height: 60; color: "#ffa94d"; radius: 4; Text { anchors.centerIn: parent; text: "B"; color: "#fff"; font.pixelSize: 18 } }
            Rectangle { width: 80; height: 60; color: "#ffe066"; radius: 4; Text { anchors.centerIn: parent; text: "C"; color: "#333"; font.pixelSize: 18 } }
            Rectangle { width: 80; height: 60; color: "#69db7c"; radius: 4; Text { anchors.centerIn: parent; text: "D"; color: "#fff"; font.pixelSize: 18 } }
            Rectangle { width: 80; height: 60; color: "#4dabf7"; radius: 4; Text { anchors.centerIn: parent; text: "E"; color: "#fff"; font.pixelSize: 18 } }
            Rectangle { width: 80; height: 60; color: "#748ffc"; radius: 4; Text { anchors.centerIn: parent; text: "F"; color: "#fff"; font.pixelSize: 18 } }
            Rectangle { width: 80; height: 60; color: "#f783ac"; radius: 4; Text { anchors.centerIn: parent; text: "G"; color: "#fff"; font.pixelSize: 18 } }
            Rectangle { width: 80; height: 60; color: "#ff6b6b"; radius: 4; Text { anchors.centerIn: parent; text: "H"; color: "#fff"; font.pixelSize: 18 } }
            Rectangle { width: 80; height: 60; color: "#ffa94d"; radius: 4; Text { anchors.centerIn: parent; text: "I"; color: "#fff"; font.pixelSize: 18 } }
            Rectangle { width: 80; height: 60; color: "#ffe066"; radius: 4; Text { anchors.centerIn: parent; text: "J"; color: "#333"; font.pixelSize: 18 } }
            Rectangle { width: 80; height: 60; color: "#69db7c"; radius: 4; Text { anchors.centerIn: parent; text: "K"; color: "#fff"; font.pixelSize: 18 } }
            Rectangle { width: 80; height: 60; color: "#4dabf7"; radius: 4; Text { anchors.centerIn: parent; text: "L"; color: "#fff"; font.pixelSize: 18 } }
        }
    }
}
