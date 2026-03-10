import QtQuick 2.15

Rectangle {
    id: root
    width: 800
    height: 580
    color: "#09090B"
    clip: true

    /* ── colour tokens ── */
    readonly property color colBg:        "#09090B"
    readonly property color colSurface:   "#18181B"
    readonly property color colText:      "#FAFAFA"
    readonly property color colSecondary: "#A1A1AA"
    readonly property color colMuted:     "#52525B"
    readonly property color colAccent:    "#3B82F6"
    readonly property color colBorder:    "#27272A"

    /* ── slide data ── */
    property var slides: [
        {
            "tag": "VISION",
            "title": "El futuro de la computacion personal",
            "body": "AgenOS es un sistema operativo agentico: tu voz es el interfaz, la IA es el motor. Sin menus. Sin friccion."
        },
        {
            "tag": "FOUNDATION",
            "title": "Construido sobre Debian",
            "body": "Base estable, paquetes probados, seguridad mantenida. Todo lo que necesitas para que la capa inteligente funcione sin sorpresas."
        },
        {
            "tag": "ARCHITECTURE",
            "title": "Pipeline de voz offline-first",
            "body": "Chromium + Cage + PipeWire + agente local. La infraestructura ya esta preparada para escucharte sin depender de la nube."
        },
        {
            "tag": "AGENTIC",
            "title": "Tools auditables, agente transparente",
            "body": "Cada accion del agente queda registrada. Puedes inspeccionar, aprobar o revertir. La confianza se construye con transparencia."
        }
    ]

    property int slideIndex: 0
    property int nextIndex: 0
    property bool transitioning: false

    /* ── auto-advance ── */
    Timer {
        interval: 6000
        repeat: true
        running: true
        onTriggered: {
            if (!root.transitioning) {
                root.nextIndex = (root.slideIndex + 1) % root.slides.length
                root.transitioning = true
                fadeOut.start()
            }
        }
    }

    /* ── background: subtle gradient ── */
    Rectangle {
        anchors.fill: parent
        gradient: Gradient {
            GradientStop { position: 0.0; color: "#0C0C10" }
            GradientStop { position: 1.0; color: "#060608" }
        }
    }

    /* ── decorative: large editorial slide number ── */
    Text {
        anchors.right: parent.right
        anchors.rightMargin: 24
        anchors.verticalCenter: parent.verticalCenter
        anchors.verticalCenterOffset: 20
        text: "0" + (root.slideIndex + 1)
        color: root.colText
        opacity: 0.03
        font.pixelSize: 260
        font.weight: Font.Black
        font.letterSpacing: -8
    }

    /* ── decorative: corner arc (bottom-right) ── */
    Rectangle {
        x: root.width - 140
        y: root.height - 140
        width: 280
        height: 280
        radius: 140
        color: "transparent"
        border.color: root.colBorder
        border.width: 1
        opacity: 0.5
    }

    /* ── top accent bar ── */
    Rectangle {
        anchors.top: parent.top
        anchors.left: parent.left
        width: 80
        height: 2
        color: root.colAccent
    }

    /* ── content ── */
    Item {
        id: contentArea
        anchors.fill: parent
        anchors.leftMargin: 48
        anchors.rightMargin: 48
        anchors.topMargin: 44
        anchors.bottomMargin: 36
        opacity: 1.0

        /* header: mark + branding */
        Row {
            id: headerRow
            anchors.top: parent.top
            spacing: 12

            Rectangle {
                width: 28
                height: 28
                radius: 6
                color: root.colSurface
                border.color: root.colBorder
                border.width: 1

                Text {
                    anchors.centerIn: parent
                    text: "A"
                    color: root.colAccent
                    font.pixelSize: 14
                    font.weight: Font.Bold
                }
            }

            Text {
                anchors.verticalCenter: parent.verticalCenter
                text: "AgenOS"
                color: root.colSecondary
                font.pixelSize: 13
                font.weight: Font.Medium
                font.letterSpacing: 1
            }
        }

        /* tag with accent dash */
        Row {
            id: slideTag
            anchors.top: headerRow.bottom
            anchors.topMargin: 48
            spacing: 10

            Rectangle {
                width: 20
                height: 1
                color: root.colAccent
                anchors.verticalCenter: parent.verticalCenter
            }

            Text {
                text: root.slides[root.slideIndex].tag
                color: root.colAccent
                font.pixelSize: 11
                font.weight: Font.DemiBold
                font.letterSpacing: 3
                font.family: "monospace"
            }
        }

        /* title */
        Text {
            id: slideTitle
            anchors.top: slideTag.bottom
            anchors.topMargin: 16
            anchors.left: parent.left
            anchors.right: parent.right
            text: root.slides[root.slideIndex].title
            wrapMode: Text.Wrap
            color: root.colText
            font.pixelSize: 32
            font.weight: Font.Bold
            lineHeight: 1.12
        }

        /* body */
        Text {
            id: slideBody
            anchors.top: slideTitle.bottom
            anchors.topMargin: 20
            anchors.left: parent.left
            width: parent.width * 0.7
            text: root.slides[root.slideIndex].body
            wrapMode: Text.Wrap
            color: root.colSecondary
            font.pixelSize: 15
            lineHeight: 1.6
        }

        /* separator */
        Rectangle {
            anchors.top: slideBody.bottom
            anchors.topMargin: 32
            width: 48
            height: 1
            color: root.colBorder
        }

        /* bottom: animated pill indicators */
        Row {
            anchors.bottom: parent.bottom
            anchors.left: parent.left
            spacing: 6

            Repeater {
                model: root.slides.length
                delegate: Rectangle {
                    width: index === root.slideIndex ? 28 : 8
                    height: 3
                    radius: 1.5
                    color: index === root.slideIndex ? root.colAccent : root.colBorder

                    Behavior on width {
                        NumberAnimation { duration: 300; easing.type: Easing.OutCubic }
                    }
                    Behavior on color {
                        ColorAnimation { duration: 300 }
                    }
                }
            }
        }

        /* counter */
        Text {
            anchors.bottom: parent.bottom
            anchors.right: parent.right
            text: (root.slideIndex + 1) + " / " + root.slides.length
            color: root.colMuted
            font.pixelSize: 11
            font.family: "monospace"
        }
    }

    /* ── fade-out ── */
    NumberAnimation {
        id: fadeOut
        target: contentArea
        property: "opacity"
        from: 1.0; to: 0.0
        duration: 200
        easing.type: Easing.InQuad
        onFinished: {
            root.slideIndex = root.nextIndex
            fadeIn.start()
        }
    }

    /* ── fade-in ── */
    NumberAnimation {
        id: fadeIn
        target: contentArea
        property: "opacity"
        from: 0.0; to: 1.0
        duration: 300
        easing.type: Easing.OutQuad
        onFinished: root.transitioning = false
    }
}
