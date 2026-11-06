function showNotification(message: string, isError: boolean = false): void {
  const notification = document.createElement('div');
  notification.className = `copy-notification${isError ? ' error' : ''}`;
  notification.textContent = message;
  document.body.appendChild(notification);

  notification.addEventListener('animationend', () => notification.remove());
}

function copyToClipboard(
  text: string,
  notificationMessage: string = 'URL copied to clipboard!'
): void {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => {
        showNotification(notificationMessage);
      })
      .catch(err => {
        console.error('Failed to copy using Clipboard API: ', err);
        showNotification('Failed to copy to clipboard.', true);
      });
  } else {
    console.warn('Clipboard API not supported in this browser.');
    showNotification('Copy to clipboard not supported in this browser.', true);
  }
}

function handleCopyLinkClick(event: MouseEvent): void {
  const button = (event.target as HTMLElement).closest<HTMLElement>('.copy-text-link');
  if (!button) return;

  event.preventDefault();
  const textToCopy = button.getAttribute('data-copy-text');
  if (textToCopy) {
    copyToClipboard(textToCopy, button.getAttribute('data-notification-message') ?? undefined);
  }
}

/** Makes every `.copy-text-link` copy its `data-copy-text` when clicked. */
export function initCopyLinks(): void {
  document.body.addEventListener('click', handleCopyLinkClick);
}
