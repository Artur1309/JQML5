import QtQuick 2.15
import QtQuick.Controls 2.0
import QtQuick.Layouts 1.15

// Layouts demo – showcases RowLayout, ColumnLayout and GridLayout.
//
// Top section    – RowLayout: fillWidth / fixed / fillHeight
// Middle section – ColumnLayout: fillWidth items with different alignments
// Bottom section – GridLayout: 3-column grid with spanning and mixed fill

Item {
    id: root
    width: 960
    height: 700

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
            text: "Layouts Demo  –  RowLayout · ColumnLayout · GridLayout"
            color: "#ffffff"
            font.pixelSize: 15
        }
    }

    // -----------------------------------------------------------------------
    // Section 1 – RowLayout (fill vs. fixed width; alignment)
    // -----------------------------------------------------------------------
    Rectangle {
        id: section1
        anchors.top: header.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.topMargin: 8
        height: 200
        color: "#f0f4ff"
        radius: 4

        Text {
            id: lbl1
            x: 12; y: 8
            text: "RowLayout  (fillWidth / fixed / fillHeight + alignment)"
            font.pixelSize: 12
            color: "#555"
        }

        // RowLayout that fills the lower part of section1
        RowLayout {
            id: rowDemo
            anchors.top: lbl1.bottom
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            anchors.margins: 10
            spacing: 8

            // Fills all remaining horizontal space
            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                color: "#4dabf7"
                radius: 4
                Text {
                    anchors.centerIn: parent
                    text: "fillWidth\nfillHeight"
                    color: "#fff"
                    font.pixelSize: 12
                }
            }

            // Fixed width, top-aligned
            Rectangle {
                Layout.preferredWidth: 120
                Layout.fillHeight: true
                Layout.alignment: Qt.AlignTop
                color: "#ff6b6b"
                radius: 4
                Text {
                    anchors.centerIn: parent
                    text: "fixed 120\nAlignTop"
                    color: "#fff"
                    font.pixelSize: 12
                }
            }

            // Fixed width, bottom-aligned
            Rectangle {
                Layout.preferredWidth: 120
                Layout.preferredHeight: 60
                Layout.alignment: Qt.AlignBottom
                color: "#69db7c"
                radius: 4
                Text {
                    anchors.centerIn: parent
                    text: "pref 120×60\nAlignBottom"
                    color: "#fff"
                    font.pixelSize: 11
                }
            }

            // Fill, but with minimumWidth clamping
            Rectangle {
                Layout.fillWidth: true
                Layout.minimumWidth: 80
                Layout.maximumWidth: 180
                Layout.fillHeight: true
                color: "#ffa94d"
                radius: 4
                Text {
                    anchors.centerIn: parent
                    text: "fill min80\nmax180"
                    color: "#fff"
                    font.pixelSize: 12
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Section 2 – ColumnLayout (fillHeight + horizontal alignment)
    // -----------------------------------------------------------------------
    Rectangle {
        id: section2
        anchors.top: section1.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.topMargin: 8
        height: 200
        color: "#fff8f0"
        radius: 4

        Text {
            id: lbl2
            x: 12; y: 8
            text: "ColumnLayout  (fillHeight + AlignLeft / AlignHCenter / AlignRight)"
            font.pixelSize: 12
            color: "#555"
        }

        ColumnLayout {
            anchors.top: lbl2.bottom
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            anchors.margins: 10
            spacing: 6

            // Stretches to fill available vertical space
            Rectangle {
                Layout.fillHeight: true
                Layout.fillWidth: true
                color: "#748ffc"
                radius: 4
                Text {
                    anchors.centerIn: parent
                    text: "fillHeight + fillWidth"
                    color: "#fff"
                    font.pixelSize: 12
                }
            }

            // Fixed size, centred horizontally
            Rectangle {
                Layout.preferredWidth: 200
                Layout.preferredHeight: 36
                Layout.alignment: Qt.AlignHCenter
                color: "#f783ac"
                radius: 4
                Text {
                    anchors.centerIn: parent
                    text: "pref 200  AlignHCenter"
                    color: "#fff"
                    font.pixelSize: 12
                }
            }

            // Fixed size, right-aligned
            Rectangle {
                Layout.preferredWidth: 200
                Layout.preferredHeight: 36
                Layout.alignment: Qt.AlignRight
                color: "#ff6b6b"
                radius: 4
                Text {
                    anchors.centerIn: parent
                    text: "pref 200  AlignRight"
                    color: "#fff"
                    font.pixelSize: 12
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Section 3 – GridLayout (3 columns, explicit rows/cols, spacing)
    // -----------------------------------------------------------------------
    Rectangle {
        id: section3
        anchors.top: section2.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.topMargin: 8
        color: "#f0fff0"
        radius: 4

        Text {
            id: lbl3
            x: 12; y: 8
            text: "GridLayout  (columns: 3, mixed fill, explicit row/column)"
            font.pixelSize: 12
            color: "#555"
        }

        GridLayout {
            anchors.top: lbl3.bottom
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            anchors.margins: 10
            columns: 3
            columnSpacing: 8
            rowSpacing: 8

            // Row 0 ─────────────────────────────────────────────────────
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 60
                color: "#4dabf7"; radius: 4
                Text { anchors.centerIn: parent; text: "(0,0) fillWidth"; color: "#fff"; font.pixelSize: 12 }
            }
            Rectangle {
                Layout.preferredWidth: 140
                Layout.preferredHeight: 60
                color: "#ff6b6b"; radius: 4
                Text { anchors.centerIn: parent; text: "(0,1) fixed 140"; color: "#fff"; font.pixelSize: 12 }
            }
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 60
                color: "#69db7c"; radius: 4
                Text { anchors.centerIn: parent; text: "(0,2) fillWidth"; color: "#fff"; font.pixelSize: 12 }
            }

            // Row 1 ─────────────────────────────────────────────────────
            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                Layout.minimumHeight: 40
                color: "#ffa94d"; radius: 4
                Text { anchors.centerIn: parent; text: "(1,0)\nfillWidth\nfillHeight"; color: "#fff"; font.pixelSize: 11 }
            }
            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                color: "#748ffc"; radius: 4
                Text { anchors.centerIn: parent; text: "(1,1)\nfillHeight"; color: "#fff"; font.pixelSize: 11 }
            }
            Rectangle {
                Layout.preferredWidth: 140
                Layout.fillHeight: true
                Layout.alignment: Qt.AlignBottom
                color: "#f783ac"; radius: 4
                Text { anchors.centerIn: parent; text: "(1,2)\nfixed w\nAlignBottom"; color: "#fff"; font.pixelSize: 11 }
            }

            // Row 2 – explicitly placed cell ────────────────────────────
            Rectangle {
                Layout.row: 2; Layout.column: 0
                Layout.fillWidth: true
                Layout.preferredHeight: 50
                color: "#ffe066"; radius: 4
                Text { anchors.centerIn: parent; text: "(2,0) explicit row/col"; color: "#333"; font.pixelSize: 12 }
            }
            Rectangle {
                Layout.row: 2; Layout.column: 1
                Layout.columnSpan: 2
                Layout.fillWidth: true
                Layout.preferredHeight: 50
                color: "#a9e34b"; radius: 4
                Text { anchors.centerIn: parent; text: "(2,1) columnSpan 2"; color: "#333"; font.pixelSize: 12 }
            }
        }
    }
}
