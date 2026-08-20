package lab.partydiag;

import java.lang.instrument.Instrumentation;
import java.lang.reflect.*;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;

/** Focused one-shot object graph scan of the two live battle owners. */
public final class PartyDiagnosticAgentV2 {
  private PartyDiagnosticAgentV2() {}

  public static void agentmain(String options, Instrumentation instrumentation) {
    StringBuilder report = new StringBuilder();
    try {
      Class<?> globals = loaded(instrumentation, "f.Ot");
      Object battle = globals.getField("Bu").get(null);
      report.append("battle=").append(summary(battle)).append('\n');
      if (battle != null) {
        for (Field field : fields(battle.getClass())) {
          if (Modifier.isStatic(field.getModifiers())) continue;
          field.trySetAccessible();
          Object value = field.get(battle);
          report.append("battle.").append(field.getName()).append('=').append(summary(value)).append('\n');
        }
        Object owners = field(battle.getClass(), "R20").get(battle);
        for (int index = 0; index < Array.getLength(owners); index++) {
          Object owner = Array.get(owners, index);
          report.append("OWNER ").append(index).append(' ').append(summary(owner)).append('\n');
          scan(report, "owner" + index, owner, 0, 5, Collections.newSetFromMap(new IdentityHashMap<>()));
        }
      }
    } catch (Throwable error) {
      report.append("ERROR ").append(error).append('\n');
      for (StackTraceElement element : error.getStackTrace()) report.append("  at ").append(element).append('\n');
    }
    try {
      Files.writeString(Path.of(options), Instant.now() + System.lineSeparator() + report,
        StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
    } catch (Throwable ignored) {}
  }

  private static void scan(StringBuilder out, String path, Object value, int depth, int maxDepth, Set<Object> seen) throws Exception {
    if (value == null || depth > maxDepth || seen.contains(value)) return;
    seen.add(value);
    Class<?> type = value.getClass();
    if (type.isArray()) {
      for (int index = 0; index < Math.min(Array.getLength(value), 16); index++) {
        Object child = Array.get(value, index);
        String childPath = path + '[' + index + ']';
        out.append(childPath).append('=').append(summary(child)).append('\n');
        if (descend(child)) scan(out, childPath, child, depth + 1, maxDepth, seen);
      }
      return;
    }
    if (value instanceof Collection<?> collection) {
      int index = 0;
      for (Object child : collection) {
        if (index >= 16) break;
        String childPath = path + '[' + index++ + ']';
        out.append(childPath).append('=').append(summary(child)).append('\n');
        if (descend(child)) scan(out, childPath, child, depth + 1, maxDepth, seen);
      }
      return;
    }
    if (!type.getName().startsWith("f.")) return;
    for (Field candidate : fields(type)) {
      if (Modifier.isStatic(candidate.getModifiers()) || candidate.isSynthetic()) continue;
      try {
        candidate.trySetAccessible();
        Object child = candidate.get(value);
        String childPath = path + '.' + candidate.getName();
        out.append(childPath).append('=').append(summary(child)).append('\n');
        if (descend(child)) scan(out, childPath, child, depth + 1, maxDepth, seen);
      } catch (Throwable error) {
        out.append(path).append('.').append(candidate.getName()).append("=<").append(error.getClass().getSimpleName()).append(">\n");
      }
    }
  }

  private static boolean descend(Object value) {
    if (value == null) return false;
    Class<?> type = value.getClass();
    return type.isArray() || value instanceof Collection<?> || type.getName().startsWith("f.");
  }

  private static String summary(Object value) {
    if (value == null) return "null";
    Class<?> type = value.getClass();
    if (type.isArray()) {
      int length = Array.getLength(value);
      StringBuilder text = new StringBuilder(type.getName()).append(" length=").append(length).append(" values=[");
      for (int index = 0; index < Math.min(length, 12); index++) {
        if (index > 0) text.append(',');
        Object item = Array.get(value, index);
        text.append(item == null ? "null" : simple(item));
      }
      return text.append(']').toString();
    }
    if (value instanceof Collection<?> collection) return type.getName() + " size=" + collection.size();
    return type.getName() + ' ' + simple(value);
  }

  private static String simple(Object value) {
    Class<?> type = value.getClass();
    if (value instanceof Number || value instanceof Boolean || value instanceof Character || value instanceof String || type.isEnum()) {
      return String.valueOf(value).replace('\n', ' ');
    }
    return '@' + Integer.toHexString(System.identityHashCode(value));
  }

  private static Field field(Class<?> type, String name) throws Exception {
    for (Class<?> cursor = type; cursor != null; cursor = cursor.getSuperclass()) try {
      Field result = cursor.getDeclaredField(name); result.trySetAccessible(); return result;
    } catch (NoSuchFieldException ignored) {}
    throw new NoSuchFieldException(name);
  }

  private static List<Field> fields(Class<?> type) {
    List<Field> result = new ArrayList<>();
    for (Class<?> cursor = type; cursor != null; cursor = cursor.getSuperclass()) result.addAll(Arrays.asList(cursor.getDeclaredFields()));
    return result;
  }

  private static Class<?> loaded(Instrumentation instrumentation, String name) {
    for (Class<?> type : instrumentation.getAllLoadedClasses()) if (type.getName().equals(name)) return type;
    throw new IllegalStateException("Class not loaded: " + name);
  }
}
