const LightBGColor = '#f0f0f0'
const DarkBGColor = '#1f1f1f'
const GenericBGColor = '#e0e0e0'
const NameSeparator = '/'

function checkIconName(name) {
    return name.indexOf(NameSeparator) < 0 && name.indexOf(" ") < 0
}

function getAndCheckCurrentPage() {
    var currentDoc = Document.getSelectedDocument()
    if (!currentDoc)
        UI.alert("No Document", "Please select a document")

    var currentPage = currentDoc.selectedPage

    if (!currentPage)
        UI.alert("No Page", "Please select a page")
    return currentPage
}

var Document = require('sketch/dom')
var UI = require('sketch/ui')
const { spawnSync } = require('@skpm/child_process')
var PATH = require('@skpm/path')
var FS = require('@skpm/fs')

export function OnExportIcon() {
    UI.message("Export Icon")
    const currentDoc = Document.getSelectedDocument()
    if (!currentDoc) {
        UI.alert("No Document", "You need to active a document")
        return
    }

    doExportIcon(Document.getSelectedDocument().selectedLayers.layers)
}

export function OnExportPage() {
    UI.message("Export Page")
    const currentDoc = Document.getSelectedDocument()
    if (!currentDoc) {
        UI.alert("No Document", "You need to active a document")
        return
    }

    doExportIcon(Document.getSelectedDocument().selectedPage.layers)
}

export function OnExportAll() {
    UI.message("Export All")
    const currentDoc = Document.getSelectedDocument()
    if (!currentDoc) {
        UI.alert("No Document", "You need to active a document")
        return
    }

    var layers = []
    for (var page of currentDoc.pages) {
        layers = layers.concat(page.layers)
    }

    doExportIcon(layers)
}

// unpack the dci file
export function OnOpen() {
    var savePanel = NSOpenPanel.openPanel()
    savePanel.title = "Show DCI Files"
    savePanel.prompt = "Show"
    savePanel.message = "Please choose the DCI files"
    savePanel.canCreateDirectories = false
    savePanel.canChooseFiles = true
    savePanel.canChooseDirectories = false
    savePanel.allowsMultipleSelection = true
    const result = savePanel.runModal()
    if (result !== NSModalResponseOK)
        return
    var openFiles = savePanel.URLs()
    if (openFiles.length === 0)
        return
    for (var i = 0; i < openFiles.length; ++i)
        showDciFileContents(openFiles[i])
}

function showDciFileContents(url) {
    const path = url.path()
    if (!path.endsWith(".dci"))
        return
    // check dci command
    try {
        FS.accessSync("/usr/local/bin/dci", FS._R_OK)
    } catch {
        UI.alert("No DCI command", "Please install the \"dci\"")
        return
    }

    const output = spawnSync("dci", ['--export', PATH.dirname(path), path])
    const newDir = PATH.join(PATH.dirname(path), PATH.basename(path, ".dci"))
    if (output && output.status === 0) {
        // add suffix for image files
        for (var dir of FS.readdirSync(newDir)) {
            if (dir.indexOf("ground@") < 0)
                continue
            var format = PATH.dirname(dir).split(".")
            format = format[format.length - 1]
            
            if (typeof format === "string")
                FS.renameSync(PATH.join(newDir, dir), PATH.join(newDir, dir + "." + format))
        }
    }
    
    try {
        FS.accessSync(newDir, FS._R_OK)
        var workspace = NSWorkspace.sharedWorkspace()
        workspace.openFile(newDir)
    } catch {
        UI.message(`Failed on show ${path}`)
    }
}

function parseIconName(name) {
    var nameSections = name.split(NameSeparator)
    // invalid name
    if (nameSections.length < 4 || nameSections.length > 5) {
        return
    }

    if (nameSections[0] !== "D")
        return

    return {
        name: nameSections[1],
        type: nameSections[2],
        mode: nameSections[3],
        isBackground: nameSections[4] === "Background"
    }
}

function doArtboardClassifyForIconName(layers) {
    var allIcon = {}

    for (var layer of layers) {
        if (layer.type != "Artboard")
            continue

        var iconProperies = parseIconName(layer.name)
        if (!iconProperies)
            continue
        iconProperies['object'] = layer
        var list = allIcon[iconProperies.name]
        if (!list)
            list = []
        list.push(iconProperies)
        allIcon[iconProperies.name] = list
    }

    return allIcon
}

function doExportIcon(layers) {
    // check dci command
    try {
        FS.accessSync("/usr/local/bin/dci", FS._R_OK)
    } catch {
        UI.alert("No DCI command", "Please install the \"dci\"")
        return
    }

    const allIcon = doArtboardClassifyForIconName(layers)
    if (!allIcon) {
        return
    }
    var savePanel = NSOpenPanel.openPanel()
    savePanel.title = "Export DCI"
    savePanel.prompt = "Export"
    savePanel.message = "Please choose a directory"
    savePanel.canCreateDirectories = true
    savePanel.canChooseFiles = false
    savePanel.canChooseDirectories = true
    savePanel.allowsMultipleSelection = false
    const result = savePanel.runModal()
    if (result !== NSModalResponseOK)
        return
    var saveDir = savePanel.URL().path()
    if (saveDir == "")
        return

    UI.message(`Saveing to ${saveDir}`)
    for (const iconName in allIcon) {
        var iconProperies = {
            name: iconName,
            scales: [1, 2, 3],
            fileList: [/*{
                path: '',
                format: 'webp'
                exportFormats: [],
                dataOfBase64: ''
            }*/]
        }
        const iconFileList = allIcon[iconName]
        const iconPath = PATH.join(saveDir, iconName + ".dci")
        // create directory for the icon
        try {
            FS.accessSync(iconPath, FS._R_OK)
            if (!userAccpetOverrideFile(iconPath)) {
                console.log(`Skip ${iconName} on export`)
                continue
            }
            // clean
            spawnSync("rm", [iconPath])
        } catch {
            // continue
        }

        const tmpDir = FS.mkdtempSync("/tmp/dci-sketch-");
        if (tmpDir === undefined) {
            UI.alert(`Failed on export ${iconName}`, `Can't create the "${tmpDir}" directory`)
            continue
        }
        const tmpPath = PATH.join(tmpDir, iconName)
        if (!createDirectory(tmpPath, true)) {
            UI.alert(`Failed on export ${iconName}`, `Can't create the "${tmpPath}" directory`)
            continue
        }

        for (const file of iconFileList) {
            var subdirNames = generateIconFileNamesByProperies(file, "")
            if (subdirNames === undefined) {
                UI.alert("Warning!", `The "${file.object.name}" is a invalid icon`);
                continue
            }

            var targetScaleList = []
            // find image pixel ratio list of export
            for (const format of file.object.exportFormats) {
                const size = format.size
                if (size.endsWith("x") && !size.endsWith("px")) {
                    const sizeNumber = Number(size.slice(0, -1))
                    if (Number.isNaN(sizeNumber))
                        continue
                    targetScaleList.push({scale: sizeNumber, suffix: format.suffix})
                }
            }

            if (targetScaleList.length === 0)
                continue;

            for (const format of file.object.exportFormats) {
                var size = format.size
                // Only allows set the icon pixel size
                const sizeSuffixs = ['w', 'h', 'px', 'width', 'height']
                for (const ss of sizeSuffixs) {
                    if (size.endsWith(ss)) {
                        size = size.slice(0, -ss.length)
                        break
                    }
                }

                if (size === format.size)
                    continue
                const sizeNumber = Number(size)
                if (Number.isNaN(sizeNumber))
                    continue

                var linkDir
                var doLink = false
                for (const subdirName of subdirNames) {
                    const filePath = PATH.join(tmpPath, file.type.toLowerCase(), size, subdirName + format.fileFormat)
                    if (!createDirectory(filePath, { recursive: true })) {
                        UI.message(`Failed on create "${filePath}", will to skip it`)
                        continue
                    }

                    for (const scale of targetScaleList) {
                        const imageScale = sizeNumber * scale.scale / file.object.frame.width
                        const data = Document.export(file.object, { formats: format.fileFormat, output: false, scales: String(imageScale) })
                        const fileBaseName = (file.isBackground ? "background" : "foreground") + format.suffix + scale.suffix
                        const imageFile = PATH.join(filePath, fileBaseName)
                        if (doLink) {
                            const linkSourcePath = PATH.join(PATH.relative(filePath, linkDir), fileBaseName)
                            console.log("link from:", linkSourcePath, "to:", imageFile)
                            FS.symlinkSync(linkSourcePath, imageFile)
                        } else {
                            linkDir = filePath
                            FS.writeFileSync(imageFile, data)
                        }
                    }

                    doLink = true
                }
            }
        }
        const args = ["--create", saveDir, tmpPath]
        var output = spawnSync("dci", args)
        console.log("Command: dci, Arguments:", args)
        console.log(output, output.stdout.toString(), output.stderr.toString())
        // clean
        FS.rmdirSync(tmpDir, {force: true, recursive: true})
        if (output && output.status === 0) {
            UI.message(`Sussced`)
        }
    }
    UI.message("Finished")
}

function userAccpetOverrideFile(filePath) {
    var options = ['Override', 'Skip']
    var selection = UI.getSelectionFromUser(`The "${filePath}" existed!`, options)
    if (!selection[2])
        return

    return selection[1] === 0
}

function generateIconFileNamesByProperies(properies, format) {
    const modeName = properies.mode.toLowerCase()
    
    if (properies.object.background.color.startsWith(GenericBGColor)) {
        return [`${modeName}.light.${format}`, `${modeName}.dark.${format}`]
    } else  if (properies.object.background.color.startsWith(LightBGColor)) {
        return [`${modeName}.light.${format}`]
    } else if (properies.object.background.color.startsWith(DarkBGColor)) {
        return [`${modeName}.dark.${format}`]
    } else {
        console.log(`Invalid background color: ${properies.object.background.color} of ${properies.name}`)
        return
    }
}

function createDirectory(path, recursive) {
    try {
        FS.mkdirSync(path, {recursive: recursive})
        return true
    } catch {
        return false
    }
}
