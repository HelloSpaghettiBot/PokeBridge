package lab.snapshotagent;

import java.io.IOException;
import java.lang.instrument.Instrumentation;
import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.Arrays;

/** One-shot dump of the underlying battle creature records. */
public final class CreatureSnapshotAgent {
  private CreatureSnapshotAgent() {}
  public static void agentmain(String options, Instrumentation instrumentation) {
    String[] values = options.split(",", -1);
    new Thread(() -> run(Path.of(values[0]), values[1], instrumentation), "creature-snapshot").start();
  }
  private static void run(Path log, String tag, Instrumentation instrumentation) {
    try {
      Class<?> globals = loaded(instrumentation, "f.Ot");
      Object battle = globals.getField("Bu").get(null);
      Object matrix = battle.getClass().getField("dO").get(battle);
      for (int side = 0; side < Array.getLength(matrix); side++) {
        Object row = Array.get(matrix, side);
        for (int slot = 0; slot < Array.getLength(row); slot++) {
          Object pokemon = Array.get(row, slot);
          if (pokemon == null) continue;
          Object model = pokemon.getClass().getField("ZU").get(pokemon);
          Object creature = model.getClass().getField("pE").get(model);
          StringBuilder text = new StringBuilder("CREATURE tag=").append(tag).append(" side=").append(side).append(" slot=").append(slot);
          for (Field field : creature.getClass().getDeclaredFields()) {
            if (Modifier.isStatic(field.getModifiers()) || !field.trySetAccessible()) continue;
            Object value = field.get(creature);
            if (value instanceof Number || value instanceof Boolean || value instanceof String || value == null) {
              text.append(' ').append(field.getName()).append('=').append(value);
            } else if (value instanceof byte[] bytes) {
              text.append(' ').append(field.getName()).append('=').append(Arrays.toString(bytes));
            } else if (value instanceof short[] shorts) {
              text.append(' ').append(field.getName()).append('=').append(Arrays.toString(shorts));
            }
          }
          write(log, text.toString());
        }
      }
    } catch (Throwable error) { write(log, "CREATURE_ERROR tag=" + tag + " " + error); }
  }
  private static Class<?> loaded(Instrumentation instrumentation, String name) {
    for (Class<?> type : instrumentation.getAllLoadedClasses()) if (type.getName().equals(name)) return type;
    throw new IllegalStateException(name);
  }
  private static synchronized void write(Path path, String message) {
    try { Files.writeString(path, Instant.now() + " " + message + System.lineSeparator(), StandardOpenOption.CREATE, StandardOpenOption.APPEND); }
    catch (IOException ignored) {}
  }
}
