package lab.inputagent;

import java.io.IOException;
import java.lang.instrument.Instrumentation;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;

/**
 * Drives the official client's own libGDX input state. This is used to obtain
 * authoritative movement packets from the already authenticated client; the
 * resulting packets are captured by packet-agent and become headless fixtures.
 */
public final class InputAgent {
  private InputAgent() {}

  public static void agentmain(String options, Instrumentation instrumentation) {
    String[] values = (options == null ? "" : options).split(",", -1);
    if (values.length != 5) {
      throw new IllegalArgumentException("Expected LOG_PATH,GDX_KEY,DURATION_MS,REPEAT,BETWEEN_MS");
    }
    Path logPath = Path.of(values[0]).toAbsolutePath();
    int key = Integer.parseInt(values[1]);
    int durationMs = Integer.parseInt(values[2]);
    int repeat = Integer.parseInt(values[3]);
    int betweenMs = Integer.parseInt(values[4]);

    Thread worker = new Thread(() -> run(logPath, key, durationMs, repeat, betweenMs), "codex-input-agent");
    worker.setDaemon(true);
    worker.start();
  }

  private static void run(Path logPath, int key, int durationMs, int repeat, int betweenMs) {
    try {
      Class<?> globals = Class.forName("f.Ot");
      Field inputField = globals.getDeclaredField("Da");
      inputField.setAccessible(true);
      Object input = inputField.get(null);
      Method setKey = input.getClass().getDeclaredMethod("R91", int.class, boolean.class);
      setKey.setAccessible(true);

      for (int index = 0; index < repeat; index += 1) {
        setKey.invoke(input, key, true);
        Thread.sleep(durationMs);
        setKey.invoke(input, key, false);
        if (index + 1 < repeat) Thread.sleep(betweenMs);
      }
      write(logPath, "complete key=" + key + " repeat=" + repeat);
    } catch (Throwable error) {
      write(logPath, "error " + error);
    }
  }

  private static void write(Path path, String message) {
    try {
      Path parent = path.getParent();
      if (parent != null) Files.createDirectories(parent);
      Files.writeString(path, Instant.now() + " " + message + System.lineSeparator(),
        StandardOpenOption.CREATE, StandardOpenOption.APPEND);
    } catch (IOException ignored) {
      // Never affect the game if diagnostic output fails.
    }
  }
}
