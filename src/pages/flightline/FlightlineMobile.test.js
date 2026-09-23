import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import FlightlineMobile, { projectProgress, jobState, jobTaskSummary, latestExport, timeAgo } from './FlightlineMobile';
import { flightline } from '../../lib/flightline';
jest.mock('../../lib/flightline', () => ({
  FLIGHTLINE_ORIGIN: 'https://flightline.example', FLIGHTLINE_DOWNLOAD: '',
  flightline: jest.fn(), uploadFootage: jest.fn(), completeFlightlineHandoff: jest.fn(),
}));

const now = Date.now() / 1000;
const dashboard = {
  projects: [{ id: 'p1', name: 'Corpus pilot', clip_count: 4, counts: { approved: 1, rendered: 1, rendering: 1, queued: 1 } }],
  workers: [{ id: 'w' }],
  tasks: [
    { id: 't1', job_id: 'j1', operation: 'render', status: 'running', progress: 0.42, message: 'Rendering tracer', created: now - 60 },
    { id: 't2', job_id: 'j3', operation: 'analysis', status: 'queued', attempts: 2, created: now - 30 },
  ],
  leases: [{ job_id: 'j2', username: 'Trevor', expires: now + 600 }],
  host: { media_online: true },
};
const jobs = [
  { id: 'j1', name: 'Slider.mov', status: 'rendering', progress: 0.42, assigned_to: 'Ethan', message: 'Rendering tracer', origin: 'upload', uploaded_by: 'Ethan', created: now - 900, updated: now - 5 },
  { id: 'j2', name: 'Fastball.mov', status: 'ready', approval: { by: 'Trevor' }, exports: [{ id: 'e1', status: 'complete', resolution: '1080p', format: 'mp4' }], created: now - 7200 },
  { id: 'j3', name: 'Curve.mov', status: 'queued', message: 'Waiting for a worker', origin: 'upload', uploaded_by: 'Ethan', created: now - 120, updated: now - 120 },
];

test('progress helpers follow the service vocabulary', () => {
  expect(projectProgress(dashboard.projects[0])).toEqual({ done: 2, total: 4, ratio: 0.5 });
  expect(projectProgress({ clip_count: 0, counts: {} }).ratio).toBe(0);
  expect(jobState(jobs[0])).toBe('rendering');
  expect(jobState(jobs[1])).toBe('approved');
  expect(jobTaskSummary(dashboard.tasks, 'j1').active.operation).toBe('render');
  expect(jobTaskSummary(dashboard.tasks, 'j3').active.status).toBe('queued');
  expect(jobTaskSummary(dashboard.tasks, 'nope')).toEqual({ active: null, failed: null });
  expect(latestExport(jobs[1]).status).toBe('complete');
  expect(latestExport(jobs[0])).toBeNull();
  expect(timeAgo(now - 30, now)).toBe('just now');
  expect(timeAgo(now - 900, now)).toBe('15m ago');
  expect(timeAgo(now - 7200, now)).toBe('2h ago');
});

test('project cards show processing activity and recent uploads', async () => {
  flightline.mockImplementation(path => Promise.resolve(path === '/dashboard' ? dashboard : jobs));
  render(<FlightlineMobile open onClose={() => {}} />);
  await screen.findByText('Corpus pilot');
  expect(screen.getByText('2/4 clips finished')).toBeTruthy();
  expect(screen.getByText('50%')).toBeTruthy();
  // The processing section names the live clip, the worker task behind it, the
  // clip being edited under a lease, and the queued analysis attempt.
  await screen.findByText('Slider.mov');
  expect(screen.getByText('Rendering 42%')).toBeTruthy();
  expect(screen.getByText(/Render running · 42% · Rendering tracer/)).toBeTruthy();
  expect(screen.getByText(/Editing now · Trevor/)).toBeTruthy();
  expect(screen.getByText(/Analysis queued · attempt 2/)).toBeTruthy();
  expect(screen.getByText(/2 landed · latest by Ethan 2m ago/)).toBeTruthy();
  expect(flightline).toHaveBeenCalledWith('/jobs?project_id=p1');
});

test('drilling in lists every clip with task, export, and upload detail, read-only', async () => {
  flightline.mockImplementation(path => Promise.resolve(path === '/dashboard' ? dashboard : jobs));
  render(<FlightlineMobile open onClose={() => {}} />);
  await screen.findByText('Corpus pilot');
  fireEvent.click(screen.getByRole('button', { name: /Corpus pilot/ }));
  await screen.findByText('Approved');
  expect(screen.getByText('Export ready · 1080p mp4')).toBeTruthy();
  expect(screen.getByText(/Reviewer: Ethan · Uploaded by Ethan · 15m ago/)).toBeTruthy();
  expect(screen.getByText('Queued')).toBeTruthy();
  expect(screen.queryByText(/Upload footage/)).toBeNull();
  expect(screen.queryByText(/Create project/)).toBeNull();
  expect(flightline.mock.calls.every(([, options]) => !options || !options.method)).toBe(true);
});

test('warns when tasks are queued but no worker is online', async () => {
  flightline.mockImplementation(path => Promise.resolve(path === '/dashboard' ? { ...dashboard, workers: [] } : jobs));
  render(<FlightlineMobile open onClose={() => {}} />);
  await screen.findByText('No workers online');
  expect(screen.getByText(/1 task waiting/)).toBeTruthy();
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
