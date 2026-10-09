// A preload for a test that needs the hook to believe it runs as another user: `node --require
// fake-getuid.cjs hook.mjs`, with UNDRIFT_TEST_UID set. A process that is not root cannot become
// another user, and a directory that another user owns is what the hook must refuse.
process.getuid = () => Number(process.env.UNDRIFT_TEST_UID);
