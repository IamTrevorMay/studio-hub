import '@testing-library/jest-dom';

// Silence console noise during test runs
const noop = () => {};
global.console.log = noop;
global.console.warn = noop;
global.console.error = noop;
