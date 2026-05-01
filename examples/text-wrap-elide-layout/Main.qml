import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15

// Text wrap + elide inside layouts – demonstrates Qt 6 text measurement parity.
//
// Section 1 – WordWrap in a ColumnLayout: implicitHeight grows with the text.
// Section 2 – ElideRight / ElideLeft / ElideMiddle inside a RowLayout.
// Section 3 – maximumLineCount + ElideRight inside a GridLayout.
// Section 4 – Live-edit: type in the TextField to see wrapping/eliding update.

Item {
    id: root
    width: 860
    height: 680

    // -----------------------------------------------------------------------
    // Header
    // -----------------------------------------------------------------------
    Rectangle {
        id: header
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        height: 44
        color: "#1a1a2e"
        Text {
            anchors.verticalCenter: parent.verticalCenter
            x: 16
            text: "Text wrap + elide in Layouts  –  Qt 6 parity demo"
            color: "#ffffff"
            font.pixelSize: 15
        }
    }

    // -----------------------------------------------------------------------
    // Section 1 – WordWrap + ColumnLayout
    // implicitHeight of the ColumnLayout grows when text is long.
    // -----------------------------------------------------------------------
    Rectangle {
        id: section1
        anchors.top: header.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.topMargin: 8
        height: wrapCol.implicitHeight + 16
        color: "#f0f4ff"
        radius: 4

        Text {
            x: 12; y: 6
            text: "1. WordWrap – ColumnLayout height driven by implicitHeight"
            font.pixelSize: 11
            color: "#555"
        }

        ColumnLayout {
            id: wrapCol
            anchors.top: parent.top
            anchors.topMargin: 24
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.leftMargin: 12
            anchors.rightMargin: 12
            spacing: 6

            // Short single-line text
            Rectangle {
                color: "#cce5ff"
                radius: 3
                Layout.fillWidth: true
                implicitHeight: shortLabel.implicitHeight + 8
                Text {
                    id: shortLabel
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.margins: 4
                    anchors.verticalCenter: parent.verticalCenter
                    text: "Short text."
                    wrapMode: Text.WordWrap
                    font.pixelSize: 13
                    color: "#003366"
                }
            }

            // Long text that wraps – implicitHeight expands the parent Rectangle
            Rectangle {
                color: "#cce5ff"
                radius: 3
                Layout.fillWidth: true
                implicitHeight: longLabel.implicitHeight + 8
                Text {
                    id: longLabel
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.margins: 4
                    anchors.top: parent.top
                    anchors.topMargin: 4
                    text: "This is a much longer piece of text that will wrap across several lines when the available width is not enough to display it on a single line."
                    wrapMode: Text.WordWrap
                    font.pixelSize: 13
                    color: "#003366"
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Section 2 – Elide variants in a RowLayout
    // -----------------------------------------------------------------------
    Rectangle {
        id: section2
        anchors.top: section1.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.topMargin: 8
        height: 120
        color: "#fff8f0"
        radius: 4

        Text {
            x: 12; y: 6
            text: "2. ElideRight / ElideLeft / ElideMiddle  (each Text fixed to 220 px)"
            font.pixelSize: 11
            color: "#555"
        }

        ColumnLayout {
            anchors.top: parent.top
            anchors.topMargin: 24
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.leftMargin: 12
            anchors.rightMargin: 12
            spacing: 6

            RowLayout {
                spacing: 8
                Layout.fillWidth: true

                Text { text: "ElideRight:"; font.pixelSize: 12; color: "#555"; Layout.preferredWidth: 80 }
                Rectangle {
                    color: "#ffe8cc"
                    radius: 3
                    Layout.preferredWidth: 220
                    height: 24
                    Text {
                        anchors.fill: parent
                        anchors.margins: 2
                        text: "Long text elided on the right side of the box"
                        elide: Text.ElideRight
                        font.pixelSize: 13
                        color: "#663300"
                    }
                }
            }

            RowLayout {
                spacing: 8
                Layout.fillWidth: true

                Text { text: "ElideLeft:"; font.pixelSize: 12; color: "#555"; Layout.preferredWidth: 80 }
                Rectangle {
                    color: "#ffe8cc"
                    radius: 3
                    Layout.preferredWidth: 220
                    height: 24
                    Text {
                        anchors.fill: parent
                        anchors.margins: 2
                        text: "Long text elided on the left side of the box"
                        elide: Text.ElideLeft
                        font.pixelSize: 13
                        color: "#663300"
                    }
                }
            }

            RowLayout {
                spacing: 8
                Layout.fillWidth: true

                Text { text: "ElideMiddle:"; font.pixelSize: 12; color: "#555"; Layout.preferredWidth: 80 }
                Rectangle {
                    color: "#ffe8cc"
                    radius: 3
                    Layout.preferredWidth: 220
                    height: 24
                    Text {
                        anchors.fill: parent
                        anchors.margins: 2
                        text: "Long text elided in the middle of the string"
                        elide: Text.ElideMiddle
                        font.pixelSize: 13
                        color: "#663300"
                    }
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Section 3 – maximumLineCount + ElideRight in a GridLayout
    // -----------------------------------------------------------------------
    Rectangle {
        id: section3
        anchors.top: section2.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.topMargin: 8
        height: 130
        color: "#f0fff0"
        radius: 4

        Text {
            x: 12; y: 6
            text: "3. maximumLineCount + ElideRight  (2-column GridLayout)"
            font.pixelSize: 11
            color: "#555"
        }

        GridLayout {
            anchors.top: parent.top
            anchors.topMargin: 24
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.leftMargin: 12
            anchors.rightMargin: 12
            columns: 2
            columnSpacing: 12
            rowSpacing: 8

            Text {
                text: "1 line max:"
                font.pixelSize: 12; color: "#333"
                Layout.preferredWidth: 90
            }
            Rectangle {
                color: "#d4edda"; radius: 3
                Layout.fillWidth: true; height: 22
                Text {
                    anchors.fill: parent; anchors.margins: 2
                    text: "Line1\nLine2\nLine3"
                    maximumLineCount: 1
                    elide: Text.ElideRight
                    font.pixelSize: 13; color: "#155724"
                }
            }

            Text {
                text: "2 lines max:"
                font.pixelSize: 12; color: "#333"
                Layout.preferredWidth: 90
            }
            Rectangle {
                color: "#d4edda"; radius: 3
                Layout.fillWidth: true; height: 38
                Text {
                    anchors.fill: parent; anchors.margins: 2
                    text: "Line1\nLine2\nLine3\nLine4"
                    maximumLineCount: 2
                    elide: Text.ElideRight
                    font.pixelSize: 13; color: "#155724"
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Section 4 – Live editing: type to see wrapping update
    // -----------------------------------------------------------------------
    Rectangle {
        id: section4
        anchors.top: section3.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.topMargin: 8
        color: "#f5f0ff"
        radius: 4

        Text {
            x: 12; y: 6
            text: "4. Live text – type in the field to observe wrap / elide updates"
            font.pixelSize: 11
            color: "#555"
        }

        ColumnLayout {
            anchors.top: parent.top
            anchors.topMargin: 24
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.leftMargin: 12
            anchors.rightMargin: 12
            spacing: 8

            TextField {
                id: liveInput
                Layout.fillWidth: true
                placeholderText: "Type text here…"
                text: "Edit me to see WordWrap and ElideRight working together in a layout"
                font.pixelSize: 13
            }

            RowLayout {
                spacing: 16
                Layout.fillWidth: true

                // WordWrap box – implicitHeight adjusts automatically
                ColumnLayout {
                    spacing: 2
                    Layout.fillWidth: true
                    Text {
                        text: "WordWrap (width: 240)"
                        font.pixelSize: 11; color: "#777"
                    }
                    Rectangle {
                        color: "#e0d4ff"
                        radius: 3
                        Layout.preferredWidth: 240
                        implicitHeight: liveWrap.implicitHeight + 8
                        Text {
                            id: liveWrap
                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.margins: 4
                            anchors.top: parent.top
                            anchors.topMargin: 4
                            text: liveInput.text
                            wrapMode: Text.WordWrap
                            font.pixelSize: 13
                            color: "#330066"
                        }
                    }
                }

                // ElideRight box – single line, truncated if too long
                ColumnLayout {
                    spacing: 2
                    Layout.fillWidth: true
                    Text {
                        text: "ElideRight (width: 240)"
                        font.pixelSize: 11; color: "#777"
                    }
                    Rectangle {
                        color: "#e0d4ff"
                        radius: 3
                        Layout.preferredWidth: 240
                        height: 26
                        Text {
                            anchors.fill: parent
                            anchors.margins: 4
                            text: liveInput.text
                            elide: Text.ElideRight
                            font.pixelSize: 13
                            color: "#330066"
                        }
                    }
                }
            }
        }
    }
}
