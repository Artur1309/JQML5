import QtQuick 2.15
import QtQuick.Controls 2.15

Item {
    id: root
    width: 800
    height: 600

    // -----------------------------------------------------------------------
    // 1. Text wrap / elide / alignment samples
    // -----------------------------------------------------------------------

    Column {
        id: textSamples
        x: 20
        y: 20
        spacing: 12

        // NoWrap + ElideRight
        Text {
            width: 200
            height: 24
            text: "Long text that will be elided on the right side"
            elide: Text.ElideRight
            font { pixelSize: 14; family: "sans-serif" }
            color: "#222222"
        }

        // WordWrap
        Text {
            width: 200
            height: 60
            text: "This text wraps at word boundaries when it exceeds the available width"
            wrapMode: Text.WordWrap
            font { pixelSize: 13; family: "sans-serif" }
            color: "#333333"
        }

        // HCenter alignment
        Text {
            width: 200
            height: 24
            text: "Centered"
            horizontalAlignment: Text.AlignHCenter
            font { pixelSize: 14; bold: true; family: "sans-serif" }
            color: "#0055aa"
        }

        // Right alignment
        Text {
            width: 200
            height: 24
            text: "Right aligned"
            horizontalAlignment: Text.AlignRight
            font { pixelSize: 14; family: "sans-serif" }
            color: "#333333"
        }

        // maximumLineCount + ElideRight
        Text {
            width: 200
            height: 48
            text: "Line1\nLine2\nLine3\nLine4"
            maximumLineCount: 2
            elide: Text.ElideRight
            font { pixelSize: 13; family: "sans-serif" }
            color: "#555555"
        }
    }

    // -----------------------------------------------------------------------
    // 2. TextInput demonstrating focus, accepted, and password echo
    // -----------------------------------------------------------------------

    Column {
        x: 260
        y: 20
        spacing: 12

        Text {
            text: "Normal TextInput:"
            font { pixelSize: 12 }
            color: "#555555"
        }

        TextInput {
            id: normalInput
            width: 240
            height: 28
            color: "#111111"
            font { pixelSize: 14; family: "sans-serif" }
            horizontalAlignment: TextInput.AlignLeft

            onAccepted: {
                statusLabel.text = "Accepted: " + normalInput.text
            }

            onTextChanged: {
                charCount.text = "Length: " + normalInput.text.length
            }
        }

        Text {
            id: charCount
            text: "Length: 0"
            font { pixelSize: 11 }
            color: "#888888"
        }

        Text {
            text: "Password TextInput:"
            font { pixelSize: 12 }
            color: "#555555"
        }

        TextInput {
            id: passwordInput
            width: 240
            height: 28
            echoMode: TextInput.Password
            color: "#111111"
            font { pixelSize: 14; family: "sans-serif" }

            onAccepted: {
                statusLabel.text = "Password accepted"
            }
        }

        Text {
            id: statusLabel
            text: "Press Enter to submit"
            font { pixelSize: 12 }
            color: "#0055aa"
            wrapMode: Text.WordWrap
            width: 240
        }
    }

    // -----------------------------------------------------------------------
    // 3. TextField control (backwards-compatible)
    // -----------------------------------------------------------------------

    Column {
        x: 540
        y: 20
        spacing: 12

        Text {
            text: "TextField control:"
            font { pixelSize: 12 }
            color: "#555555"
        }

        TextField {
            id: tf
            width: 220
            height: 36
            placeholderText: "Type here…"

            onTextChanged: {
                tfLabel.text = "Value: " + tf.text
            }
        }

        Text {
            id: tfLabel
            text: "Value: "
            font { pixelSize: 12 }
            color: "#333333"
        }
    }
}
