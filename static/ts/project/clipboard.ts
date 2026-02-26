/**
 * Project Clipboard + Notification Utilities
 */

export function showNotification(message: string, isError: boolean = false): void {
  const notification = document.createElement('div');
  notification.className = `copy-notification${isError ? ' error' : ''}`;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    if (notification.parentNode) {
      document.body.removeChild(notification);
    }
  }, 4000);
}

export function copyToClipboard(
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
        showNotification('Failed to copy the URL.', true);
      });
  } else {
    console.warn('Clipboard API not supported in this browser.');
    showNotification('Copy to clipboard not supported in this browser.', true);
  }
}
