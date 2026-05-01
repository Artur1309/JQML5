import QtQuick 2.15

// ---------------------------------------------------------------------------
// GridView demo
//
// Demonstrates:
//   A) GridView with LeftToRight flow (row-first), uniform cell size,
//      reuseItems, and attached pooled/reused handlers – derived from the
//      Qt 6 GridView documentation examples.
//   B) GridView with TopToBottom flow (column-first)
//   C) Dynamic model changes (append / remove) updating the view live
// ---------------------------------------------------------------------------

Item {
    id: root
    width: 720
    height: 560

    // -----------------------------------------------------------------------
    // Title bar
    // -----------------------------------------------------------------------
    Rectangle {
        id: titleBar
        width: root.width
        height: 44
        color: "#263238"

        Text {
            x: 16; y: 12
            text: "GridView Demo  –  LeftToRight flow · TopToBottom flow · Dynamic model"
            color: "#ffffff"
            font.pixelSize: 14
        }
    }

    // -----------------------------------------------------------------------
    // Shared model used by section A and C
    // -----------------------------------------------------------------------
    ListModel {
        id: colorModel
        ListElement { label: "Red";    bg: "#ef9a9a"; fg: "#b71c1c" }
        ListElement { label: "Pink";   bg: "#f48fb1"; fg: "#880e4f" }
        ListElement { label: "Purple"; bg: "#ce93d8"; fg: "#4a148c" }
        ListElement { label: "Indigo"; bg: "#9fa8da"; fg: "#1a237e" }
        ListElement { label: "Blue";   bg: "#90caf9"; fg: "#0d47a1" }
        ListElement { label: "Cyan";   bg: "#80deea"; fg: "#006064" }
        ListElement { label: "Teal";   bg: "#80cbc4"; fg: "#004d40" }
        ListElement { label: "Green";  bg: "#a5d6a7"; fg: "#1b5e20" }
        ListElement { label: "Lime";   bg: "#e6ee9c"; fg: "#827717" }
        ListElement { label: "Yellow"; bg: "#fff176"; fg: "#f57f17" }
        ListElement { label: "Amber";  bg: "#ffe082"; fg: "#ff6f00" }
        ListElement { label: "Orange"; bg: "#ffcc80"; fg: "#e65100" }
    }

    // -----------------------------------------------------------------------
    // Toolbar with controls for section C
    // -----------------------------------------------------------------------
    Rectangle {
        id: toolbar
        x: 0; y: 44
        width: root.width
        height: 36
        color: "#37474f"

        Row {
            x: 8; y: 6
            spacing: 8

            // Append button
            Rectangle {
                width: 90; height: 24
                color: "#4caf50"; radius: 4
                Text { anchors.centerIn: parent; text: "+ Append"; color: "#fff"; font.pixelSize: 12 }
                MouseArea {
                    anchors.fill: parent
                    onClicked: {
                        var idx = colorModel.count
                        colorModel.append({ label: "Item " + idx, bg: "#b0bec5", fg: "#263238" })
                    }
                }
            }

            // Remove last button
            Rectangle {
                width: 100; height: 24
                color: "#f44336"; radius: 4
                Text { anchors.centerIn: parent; text: "– Remove Last"; color: "#fff"; font.pixelSize: 12 }
                MouseArea {
                    anchors.fill: parent
                    onClicked: {
                        if (colorModel.count > 0)
                            colorModel.remove(colorModel.count - 1)
                    }
                }
            }

            Text {
                anchors.verticalCenter: parent.verticalCenter
                text: "count: " + colorModel.count
                color: "#eceff1"
                font.pixelSize: 12
            }
        }
    }

    // -----------------------------------------------------------------------
    // A) LeftToRight flow – row-first (default Qt GridView behaviour)
    // -----------------------------------------------------------------------
    Rectangle {
        id: ltrPanel
        x: 0; y: 80
        width: root.width / 2
        height: root.height - 80
        color: "#eceff1"
        clip: true

        Text {
            x: 8; y: 4
            text: "LeftToRight flow – reuseItems=true"
            color: "#37474f"; font.pixelSize: 11
        }

        GridView {
            id: ltrGrid
            x: 0; y: 20
            width: ltrPanel.width
            height: ltrPanel.height - 20

            model: colorModel
            cellWidth: 90
            cellHeight: 90
            spacing: 4
            cacheBuffer: 80
            reuseItems: true

            // Highlight the currently selected cell
            highlight: Rectangle {
                color: "transparent"
                border.color: "#ff6f00"
                border.width: 2
                radius: 6
            }

            delegate: Rectangle {
                width: ltrGrid.cellWidth
                height: ltrGrid.cellHeight
                color: bg
                radius: 4

                Text {
                    anchors.centerIn: parent
                    text: label
                    color: fg
                    font.pixelSize: 11
                    font.bold: true
                }

                MouseArea {
                    anchors.fill: parent
                    onClicked: ltrGrid.currentIndex = index
                }

                // Qt-like attached handlers (0 arguments, delegate reads own `index`)
                GridView.onPooled: {
                    console.log("[LTR] pooled index =", index)
                }
                GridView.onReused: {
                    console.log("[LTR] reused index =", index)
                }
            }
        }
    }

    // Divider
    Rectangle {
        x: root.width / 2 - 1; y: 80
        width: 2; height: root.height - 80
        color: "#b0bec5"
    }

    // -----------------------------------------------------------------------
    // B) TopToBottom flow – column-first
    // -----------------------------------------------------------------------
    Rectangle {
        id: ttbPanel
        x: root.width / 2 + 1; y: 80
        width: root.width / 2 - 1
        height: root.height - 80
        color: "#fce4ec"
        clip: true

        Text {
            x: 8; y: 4
            text: "TopToBottom flow – column-first"
            color: "#37474f"; font.pixelSize: 11
        }

        GridView {
            id: ttbGrid
            x: 0; y: 20
            width: ttbPanel.width
            height: ttbPanel.height - 20

            model: colorModel
            cellWidth: 85
            cellHeight: 85
            spacing: 4
            cacheBuffer: 80
            flow: "TopToBottom"

            delegate: Rectangle {
                width: ttbGrid.cellWidth
                height: ttbGrid.cellHeight
                color: bg
                radius: 4
                border.color: fg
                border.width: 1

                Column {
                    anchors.centerIn: parent
                    spacing: 2
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        text: label
                        color: fg
                        font.pixelSize: 10
                        font.bold: true
                    }
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        text: "#" + index
                        color: fg
                        font.pixelSize: 9
                    }
                }

                MouseArea {
                    anchors.fill: parent
                    onClicked: ttbGrid.currentIndex = index
                }
            }
        }
    }
}
