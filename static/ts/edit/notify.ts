type NotificationType = 'info' | 'success' | 'error' | 'warning';

const STACK_ID = 'edit-notification-stack';
// Matches the .edit-notification opacity transition in edit-mode-base.css.
const FADE_OUT_MS = 300;

export function showNotification(
  message: string,
  type: NotificationType = 'info',
  duration: number = 3000
): void {
  let stack = document.getElementById(STACK_ID);
  if (!stack) {
    stack = document.createElement('div');
    stack.id = STACK_ID;
    stack.className = 'edit-notification-stack';
    document.body.appendChild(stack);
  }

  const notification = document.createElement('div');
  notification.className = `edit-notification edit-notification-${type}`;
  notification.textContent = message;
  stack.appendChild(notification);

  requestAnimationFrame(() => {
    notification.classList.add('show');
  });

  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => {
      notification.remove();
      if (stack.childElementCount === 0) {
        stack.remove();
      }
    }, FADE_OUT_MS);
  }, duration);
}
