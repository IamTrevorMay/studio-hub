import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import FlightlineMobile, { projectProgress, jobState } from './FlightlineMobile';
import { flightline } from '../../lib/flightline';
jest.mock('../../lib/flightline', () => ({
  FLIGHTLINE_ORIGIN: 'https://flightline.example', FLIGHTLINE_DOWNLOAD: '',
  flightline: jest.fn(), uploadFootage: jest.fn(), completeFlightlineHandoff: jest.fn(),
}));

const dashboard = {
  projects: [{ id: 'p1', name: 'Corpus pilot', clip_count: 4, counts: { approved: 1, rendered: 1, rendering: 1, queued: 1 } }],
  workers: [{ id: 'w' }], tasks: [{ id: 't', status: 'running' }], host: { media_online: true },
};
const jobs = [
  { id: 'j1', name: 'Slider.mov', status: 'rendering', progress: 0.42, assigned_to: 'Ethan', message: 'Rendering tracer' },
  { id: 'j2', name: 'Fastball.mov', status: 'ready', approval: { by: 'Trevor' } },
];

test('progress helpers follow the service vocabulary', () => {
  expect(projectProgress(dashboard.projects[0])).toEqual({ done: 2, total: 4, ratio: 0.5 });
  expect(projectProgress({ clip_count: 0, counts: {} }).ratio).toBe(0);
  expect(jobState(jobs[0])).toBe('rendering');
  expect(jobState(jobs[1])).toBe('approved');
});

test('lists projects with progress, then drills into clips read-only', async () => {
  flightline.mockImplementation(path => Promise.resolve(path === '/dashboard' ? dashboard : jobs));
  render(<FlightlineMobile open onClose={() => {}} />);
  await screen.findByText('Corpus pilot');
  expect(screen.getByText('2/4 clips finished')).toBeTruthy();
  expect(screen.getByText('50%')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Corpus pilot/ }));
  await screen.findByText('Slider.mov');
  expect(screen.getByText('Rendering 42%')).toBeTruthy();
  expect(screen.getByText('Approved')).toBeTruthy();
  expect(screen.getByText(/Reviewer: Ethan/)).toBeTruthy();
  expect(screen.queryByText(/Upload/)).toBeNull();
  expect(screen.queryByText(/Create project/)).toBeNull();
  expect(flightline.mock.calls.every(([, options]) => !options || !options.method)).toBe(true);
});

test('denied accounts see the service error instead of project data', async () => {
  flightline.mockRejectedValue(new Error('Flightline access has not been enabled'));
  render(<FlightlineMobile open onClose={() => {}} />);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('has not been enabled'));
  expect(screen.queryByText('Corpus pilot')).toBeNull();
});

test('renders nothing while closed and does not poll', () => {
  flightline.mockClear();
  const { container } = render(<FlightlineMobile open={false} onClose={() => {}} />);
  expect(container.innerHTML).toBe('');
  expect(flightline).not.toHaveBeenCalled();
});
