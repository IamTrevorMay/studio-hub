// Mobile shell for the staff Reviews page. The list is already a responsive
// grid and ReviewPlayer stacks its columns in `compact` mode, so this is a
// thin wrapper that reuses the desktop component with compact layout on.
import React from 'react';
import Reviews from './Reviews';

export default function ReviewsMobile(props) {
  return <Reviews {...props} compact />;
}
