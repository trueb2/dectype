function getPortalURI(portalID) {
    return 'atom://teletype/portal/' + portalID;
}

function getEditorURI(portalId, editorProxyId) {
    return getPortalURI(portalId) + '/editor/' + editorProxyId;
}

module.exports = {getEditorURI, getPortalURI};