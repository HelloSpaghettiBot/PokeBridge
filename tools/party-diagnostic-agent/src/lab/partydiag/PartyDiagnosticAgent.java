package lab.partydiag;

import java.lang.instrument.Instrumentation;
import java.lang.reflect.*;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;

/** One-shot reflection report used to locate the official client's current party model. */
public final class PartyDiagnosticAgent {
  private PartyDiagnosticAgent() {}

  public static void agentmain(String options, Instrumentation instrumentation) {
    Path output = Path.of(options == null || options.isBlank() ? "party-diagnostic.log" : options);
    StringBuilder report = new StringBuilder();
    try {
      Class<?> globals = loaded(instrumentation, "f.Ot");
      Object battle = globals.getField("Bu").get(null);
      report.append("battle=").append(battle == null ? "null" : battle.getClass().getName()).append('\n');
      if (battle != null) {
        dumpObject(report, "battle", battle, 0, 2, Collections.newSetFromMap(new IdentityHashMap<>()));
        Object matrix = battle.getClass().getField("dO").get(battle);
        report.append("matrix=").append(summary(matrix)).append('\n');
        int rows = Array.getLength(matrix);
        for (int side = 0; side < rows; side++) {
          Object row = Array.get(matrix, side);
          report.append("matrix[").append(side).append("]=").append(summary(row)).append('\n');
          for (int slot = 0; slot < Array.getLength(row); slot++) {
            Object pokemon = Array.get(row, slot);
            report.append("matrix[").append(side).append("][").append(slot).append("]=").append(summary(pokemon)).append('\n');
            if (pokemon != null) dumpObject(report, "pokemon" + side + "_" + slot, pokemon, 0, 1, Collections.newSetFromMap(new IdentityHashMap<>()));
          }
        }
      }
      report.append("GLOBALS\n");
      for (Field field : allFields(globals)) {
        if (!Modifier.isStatic(field.getModifiers())) continue;
        try {
          field.trySetAccessible();
          Object value = field.get(null);
          report.append("global.").append(field.getName()).append(':').append(field.getType().getName()).append('=').append(summary(value)).append('\n');
        } catch (Throwable error) {
          report.append("global.").append(field.getName()).append("=<").append(error.getClass().getSimpleName()).append(">\n");
        }
      }
    } catch (Throwable error) {
      report.append("ERROR ").append(error).append('\n');
      for (StackTraceElement element : error.getStackTrace()) report.append("  at ").append(element).append('\n');
    }
    try {
      Files.writeString(output, Instant.now() + System.lineSeparator() + report,
        StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
    } catch (Throwable ignored) {}
  }

  private static void dumpObject(StringBuilder out, String label, Object value, int depth, int maxDepth, Set<Object> seen) {
    if (value == null || depth > maxDepth || seen.contains(value)) return;
    seen.add(value);
    for (Field field : allFields(value.getClass())) {
      try {
        field.trySetAccessible();
        Object child = field.get(value);
        String key = label + "." + field.getName();
        out.append(key).append(':').append(field.getType().getName()).append('=').append(summary(child)).append('\n');
        if (depth < maxDepth && shouldDescend(child)) dumpObject(out, key, child, depth + 1, maxDepth, seen);
      } catch (Throwable error) {
        out.append(label).append('.').append(field.getName()).append("=<").append(error.getClass().getSimpleName()).append(">\n");
      }
    }
  }

  private static boolean shouldDescend(Object value) {
    if (value == null || value.getClass().isArray() || value instanceof Collection<?> || value instanceof Map<?, ?>) return false;
    String name = value.getClass().getName();
    return name.startsWith("f.");
  }

  private static String summary(Object value) {
    if (value == null) return "null";
    Class<?> type = value.getClass();
    if (type.isArray()) {
      int length = Array.getLength(value);
      StringBuilder text = new StringBuilder(type.getName()).append(" length=").append(length).append(" [");
      for (int index = 0; index < Math.min(length, 8); index++) {
        if (index > 0) text.append(',');
        Object item = Array.get(value, index);
        text.append(item == null ? "null" : item.getClass().getName());
      }
      return text.append(']').toString();
    }
    if (value instanceof Collection<?> collection) return type.getName() + " size=" + collection.size();
    if (value instanceof Map<?, ?> map) return type.getName() + " size=" + map.size();
    if (value instanceof Number || value instanceof Boolean || value instanceof Character || value instanceof String || type.isEnum()) {
      return type.getName() + " " + String.valueOf(value).replace('\n', ' ');
    }
    return type.getName() + "@" + Integer.toHexString(System.identityHashCode(value));
  }

  private static List<Field> allFields(Class<?> type) {
    List<Field> fields = new ArrayList<>();
    for (Class<?> cursor = type; cursor != null; cursor = cursor.getSuperclass()) fields.addAll(Arrays.asList(cursor.getDeclaredFields()));
    return fields;
  }

  private static Class<?> loaded(Instrumentation instrumentation, String name) {
    for (Class<?> type : instrumentation.getAllLoadedClasses()) if (type.getName().equals(name)) return type;
    throw new IllegalStateException("Class not loaded: " + name);
  }
}
