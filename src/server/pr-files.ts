const TEST_DIRS = ["test", "tests", "__tests__", "spec"];
const TEST_NAME = /(\.test\.|\.spec\.|_test\.)[^./]+$|Test\.[^./]+$/;

/** Whether a repo path is a test (decision 050 D): a folder named like a test folder, or a test file name. Test config files are not tests. */
export function isTestPath(path: string) {
  const parts = path.split("/");
  const name = parts.pop() as string;
  return parts.some((dir) => TEST_DIRS.includes(dir)) || TEST_NAME.test(name);
}

/** How many app paths a story keeps (decision 050 E). */
export const APP_FILES_KEPT = 20;
