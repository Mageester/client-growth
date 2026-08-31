import { redirect } from "react-router";

export function loader() {
  return redirect("/opportunities");
}

export default function Index() {
  return null;
}
