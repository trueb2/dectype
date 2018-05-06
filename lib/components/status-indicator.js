'use babel';

const {CompositeDisposable} = require('atom');
const PopoverComponent = require('./popover-component');

module.exports =
class StatusIndicator {
  constructor (props) {
    this.props = props;
    this.subscriptions = new CompositeDisposable();
    this.element = this.buildElement(props);
    this.popoverComponent = new PopoverComponent(props);

    if (props.portalBindingManager) {
      this.subscriptions.add(this.props.portalBindingManager.onDidChange(() => {
        this.updatePortalStatus();
      }))
    }
  }

  destroy () {
    this.subscriptions.dispose();
    this.popoverComponent.destroy();
  }

  attach () {
    const PRIORITY_BETWEEN_BRANCH_NAME_AND_GRAMMAR = -40;
    this.tile = this.props.statusBar.addRightTile({
      item: this,
      priority: PRIORITY_BETWEEN_BRANCH_NAME_AND_GRAMMAR
    });
    this.tooltip = this.props.tooltipManager.add(
      this.element,
      {
        item: this.popoverComponent,
        class: 'TeletypePopoverTooltip',
        trigger: 'click',
        placement: 'top'
      }
    )
  }

  showPopover () {

  }

  buildElement (props) {
    const anchor = document.createElement('a');
    anchor.classList.add('PortalStatusBarIndicator', 'inline-block');

    const icon = document.createElement('span');
    icon.classList.add('icon', 'icon-radio-tower');
    anchor.appendChild(icon);

    return anchor;
  }

  updatePortalStatus () {

  }
};
