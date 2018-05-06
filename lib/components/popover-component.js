'use babel';

const etch = require('etch')
const $ = etch.dom
const PortalListComponent = require('./portal-list-component');

module.exports =
class PopoverComponent {
  constructor (props) {
    this.props = props
    etch.initialize(this)
  }

  update () {
    return etch.update(this)
  }

  render () {
    const {
      portalBindingManager, commandRegistry, clipboard, workspace,
      notificationManager
    } = this.props;

    const activeComponent = $(PortalListComponent, {
        ref: 'portalListComponent',
        portalBindingManager,
        clipboard,
        commandRegistry,
        notificationManager
    });

    return $.div({className: 'TeletypePopoverComponent'}, activeComponent)
  }
}
