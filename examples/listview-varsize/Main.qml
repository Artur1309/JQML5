import QtQuick 2.15

// ---------------------------------------------------------------------------
// Variable-size ListView demo
//
// Demonstrates:
//   A) Vertical ListView with variable delegate height (30 + index * 5)
//   B) Horizontal ListView with variable delegate width (40 + index * 8)
//   C) ListView.onPooled / ListView.onReused attached handlers (Qt parity,
//      called with 0 arguments on the delegate item itself)
// ---------------------------------------------------------------------------

Item {
    id: root
    width: 640
    height: 480

    // Title
    Rectangle {
        id: titleBar
        width: root.width
        height: 44
        color: "#37474f"

        Text {
            x: 16; y: 12
            text: "Variable-size ListView  –  reuseItems + attached handlers"
            color: "#ffffff"
            font.pixelSize: 14
        }
    }

    // -----------------------------------------------------------------------
    // A) Vertical ListView – variable height delegates
    // -----------------------------------------------------------------------
    Rectangle {
        id: vertPanel
        x: 0; y: 44
        width: root.width / 2
        height: root.height - 44
        color: "#fafafa"
        clip: true

        Text {
            x: 8; y: 4
            text: "Vertical – variable height"
            color: "#37474f"
            font.pixelSize: 11
        }

        ListView {
            id: vertList
            x: 0; y: 20
            width: vertPanel.width
            height: vertPanel.height - 20
            cacheBuffer: 60
            reuseItems: true

            model: 30

            delegate: Rectangle {
                width: vertList.width
                height: 30 + index * 5

                color: index % 2 === 0 ? "#e3f2fd" : "#bbdefb"
                borderColor: "#90caf9"
                borderWidth: 1

                Text {
                    x: 8; y: 4
                    text: "Row " + index + "  (h=" + parent.height + ")"
                    color: "#0d47a1"
                    font.pixelSize: 11
                }

                // Qt-like attached handlers – called with 0 arguments.
                // Delegate reads its own `index` from the context.
                ListView.onPooled: {
                    console.log("[attached] vertical item pooled, index =", index)
                }
                ListView.onReused: {
                    console.log("[attached] vertical item reused, index =", index)
                }
            }
        }
    }

    // Divider
    Rectangle {
        x: root.width / 2 - 1; y: 44
        width: 2
        height: root.height - 44
        color: "#b0bec5"
    }

    // -----------------------------------------------------------------------
    // B) Horizontal ListView – variable width delegates
    // -----------------------------------------------------------------------
    Rectangle {
        id: horizPanel
        x: root.width / 2 + 1; y: 44
        width: root.width / 2 - 1
        height: root.height - 44
        color: "#fafafa"
        clip: true

        Text {
            x: 8; y: 4
            text: "Horizontal – variable width"
            color: "#37474f"
            font.pixelSize: 11
        }

        ListView {
            id: horizList
            x: 0; y: 20
            width: horizPanel.width
            height: horizPanel.height - 20
            orientation: "horizontal"
            cacheBuffer: 60
            reuseItems: true

            model: 20

            delegate: Rectangle {
                width: 40 + index * 8
                height: horizList.height * 0.6

                color: index % 2 === 0 ? "#f3e5f5" : "#e1bee7"
                borderColor: "#ce93d8"
                borderWidth: 1

                Text {
                    x: 4; y: 4
                    text: "Col " + index
                    color: "#4a148c"
                    font.pixelSize: 10
                }
                Text {
                    x: 4; y: 18
                    text: "w=" + parent.width
                    color: "#4a148c"
                    font.pixelSize: 9
                }

                // Attached handlers on horizontal list delegate
                ListView.onPooled: {
                    console.log("[attached] horizontal item pooled, index =", index)
                }
                ListView.onReused: {
                    console.log("[attached] horizontal item reused, index =", index)
                }
            }
        }
    }
}
