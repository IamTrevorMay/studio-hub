import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import FlightlineDashboard from './FlightlineDashboard';
import { flightline } from '../../lib/flightline';
jest.mock('../../lib/flightline', () => ({
  FLIGHTLINE_ORIGIN: 'https://flightline.example', FLIGHTLINE_DOWNLOAD: '',
  flightline: jest.fn(), uploadFootage: jest.fn(), completeFlightlineHandoff: jest.fn(),
}));

test('uses the shared project Dashboard and does not offer an unpublished package', async () => {
  flightline.mockImplementation(path => Promise.resolve(path === '/dashboard' ? {
    projects: [{ id: 'project', name: 'Corpus pilot', clip_count: 1 }], workers: [{ id: 'worker' }], tasks: [], host: { media_online: true },
  } : [{ id: 'clip', name: 'Corpus footage.mov', status: 'ready' }]));
  render(<FlightlineDashboard />);
  await screen.findByText('Corpus footage.mov');
  expect(screen.getByText('1 projects')).toBeTruthy();
  expect(screen.queryByText('Download for Mac')).toBeNull();
  expect(screen.getByText('Open editing Terminal').getAttribute('href')).toBe('https://flightline.example/?signin=mayday');
});

test('denied accounts see an access error instead of project data', async () => {
  flightline.mockRejectedValue(new Error('Flightline access has not been enabled'));
  render(<FlightlineDashboard />);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('has not been enabled'));
  expect(screen.queryByLabelText('New project name')).toBeNull();
});
