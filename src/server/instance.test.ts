import { describe, expect, it } from "vitest";
import { openTestDatabase } from "./db/test-db.ts";
import { checkInstanceKey } from "./instance.ts";
import { configureTestInstance, TEST_KEY } from "./test-instance.ts";

const otherKey = Buffer.alloc(32, 9);

describe("checkInstanceKey (start-up check of the master key)", () => {
  it("given no instance_settings row yet, when the key is checked, then it resolves", async () => {
    const db = await openTestDatabase();

    await expect(checkInstanceKey(db, TEST_KEY)).resolves.not.toThrow();
  });

  it("given a configured row that the key decrypts, when the key is checked, then it resolves", async () => {
    const db = await openTestDatabase();
    await configureTestInstance(db, TEST_KEY);

    await expect(checkInstanceKey(db, TEST_KEY)).resolves.not.toThrow();
  });

  it("given a configured row that the key cannot decrypt (a regenerated or wrong master.key), when the key is checked, then it throws an error naming master.key and instance_settings", async () => {
    const db = await openTestDatabase();
    await configureTestInstance(db, TEST_KEY);

    const failure = await checkInstanceKey(db, otherKey).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).toContain("master.key");
    expect(message).toContain("instance_settings");
  });
});
