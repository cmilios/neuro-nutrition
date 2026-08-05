import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Toast from './Toast';

describe('Toast', () => {
  afterEach(() => vi.useRealTimers());

  it('announces non-modally, preserves focus, and can be dismissed', async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Existing action</button>
        <Toast
          toast={{ id: 1, kind: 'info', message: 'Sign-in was canceled.' }}
          onDismiss={onDismiss}
        />
      </>,
    );
    const existingAction = screen.getByRole('button', { name: 'Existing action' });
    existingAction.focus();

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(existingAction).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('uses the C4 mobile safe-area and desktop corner placement contract', () => {
    render(
      <Toast
        toast={{ id: 1, kind: 'info', message: 'Sign-in was canceled.' }}
        onDismiss={vi.fn()}
      />,
    );

    // JSDOM has no responsive layout engine, so this narrowly verifies the
    // responsive utility contract that the production Tailwind runtime applies.
    expect(screen.getByRole('status').parentElement).toHaveClass(
      'fixed',
      'inset-x-0',
      'bottom-[calc(env(safe-area-inset-bottom)+1rem)]',
      'w-full',
      'sm:left-auto',
      'sm:right-6',
      'sm:bottom-6',
      'sm:max-w-sm',
    );
  });

  it('auto-dismisses after approximately five seconds', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <Toast
        toast={{ id: 1, kind: 'error', message: 'Sign-in failed.' }}
        onDismiss={onDismiss}
      />,
    );

    act(() => vi.advanceTimersByTime(4_999));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('does not restart auto-dismiss when its parent rerenders', () => {
    vi.useFakeTimers();
    const firstDismiss = vi.fn();
    const latestDismiss = vi.fn();
    const { rerender } = render(
      <Toast
        toast={{ id: 1, kind: 'info', message: 'Sign-in was canceled.' }}
        onDismiss={firstDismiss}
      />,
    );

    act(() => vi.advanceTimersByTime(4_000));
    rerender(
      <Toast
        toast={{ id: 1, kind: 'info', message: 'Sign-in was canceled.' }}
        onDismiss={latestDismiss}
      />,
    );
    act(() => vi.advanceTimersByTime(1_000));

    expect(firstDismiss).not.toHaveBeenCalled();
    expect(latestDismiss).toHaveBeenCalledOnce();
  });
});
