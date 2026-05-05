import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ConfirmProvider, useConfirm } from '../../contexts/ConfirmContext';

function TestConsumer() {
  const confirm = useConfirm();
  const [result, setResult] = React.useState(null);

  const handleClick = async () => {
    const answer = await confirm('Are you sure?');
    setResult(answer);
  };

  return (
    <>
      <button onClick={handleClick}>Open</button>
      {result !== null && <span data-testid="result">{String(result)}</span>}
    </>
  );
}

function renderWithProvider() {
  return render(
    <ConfirmProvider>
      <TestConsumer />
    </ConfirmProvider>
  );
}

describe('ConfirmContext', () => {
  it('renders modal with message text', async () => {
    renderWithProvider();
    await act(async () => { fireEvent.click(screen.getByText('Open')); });
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
  });

  it('resolves true on Confirm click', async () => {
    renderWithProvider();
    await act(async () => { fireEvent.click(screen.getByText('Open')); });
    await act(async () => { fireEvent.click(screen.getByText('Confirm')); });
    expect(screen.getByTestId('result').textContent).toBe('true');
  });

  it('resolves false on Cancel click', async () => {
    renderWithProvider();
    await act(async () => { fireEvent.click(screen.getByText('Open')); });
    await act(async () => { fireEvent.click(screen.getByText('Cancel')); });
    expect(screen.getByTestId('result').textContent).toBe('false');
  });

  it('resolves false on overlay click', async () => {
    renderWithProvider();
    await act(async () => { fireEvent.click(screen.getByText('Open')); });
    // The overlay is the parent div containing the modal
    const overlay = screen.getByText('Are you sure?').parentElement.parentElement;
    await act(async () => { fireEvent.click(overlay); });
    expect(screen.getByTestId('result').textContent).toBe('false');
  });
});
